// Optional, explicit gallery-dl adapter. Its configuration is generated here;
// user config, exec hooks and extractor plugins are never loaded. Direct media
// URLs exist only in the bounded child output, not queue records or previews.
use crate::model::{Job, Options};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashSet}, fs, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf},
    process::{Command, Stdio}, sync::atomic::Ordering, thread, time::{Duration, Instant}};

pub const MAX_ITEMS: usize = 200;
const MAX_OUTPUT: u64 = 8 * 1024 * 1024;
const MAX_LINE: usize = 512 * 1024;
const FILE_MARKER: &str = "DEVI_GALLERY_FILE:";
// Revision-aware metadata keeps, for example, two Wikimedia versions distinct.
// Never include signed direct URLs: the same item must survive a token refresh.
const ID_FIELDS: [&str; 7] = ["category", "id", "filename", "num", "extension", "timestamp", "sha1"];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryItem {
    pub index: u32, pub id: String, pub title: String, pub extension: String, pub kind: String, pub bytes: Option<u64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryPreview {
    pub source: String, pub title: String, pub items: Vec<GalleryItem>, pub truncated: bool, pub fingerprint: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryInfo { pub available: bool, pub version: String, pub installation_supported: bool }

#[derive(Clone, Debug)]
struct Identity([String; 7]);
#[derive(Debug)]
struct Listing { preview: GalleryPreview, identities: Vec<Identity> }

pub fn executable(dir: &Path) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "gallery-dl.exe" } else { "gallery-dl" };
    let installed = dir.join("engines").join(name);
    if installed.is_file() { return Ok(installed); }
    crate::binary("gallery-dl").map_err(|_| "Gallery-dl is not installed. Install the optional gallery engine first.".into())
}

pub fn info(dir: &Path) -> GalleryInfo {
    let version = executable(dir).and_then(|exe| {
        let mut cmd = crate::command(&exe);cmd.args(["--config-ignore", "--no-input", "--version"]);
        run(&mut cmd, Duration::from_secs(5), &|| false, &|_| {}, &mut |_| Ok(()), false)
            .and_then(|out| if out.success { Ok(short(&String::from_utf8_lossy(&out.stdout), 64)) } else { Err(failure(&out.stderr)) })
    }).unwrap_or_default();
    GalleryInfo {available: !version.is_empty(), version,
        installation_supported: cfg!(all(target_arch="x86_64", any(target_os="windows", target_os="linux")))}
}

pub fn validate_source(source: &str) -> Result<String, String> {
    if source.len() > 8192 || source.chars().any(char::is_control) { return Err("Enter one HTTP or HTTPS gallery link.".into()); }
    let mut url = url::Url::parse(source.trim()).map_err(|_| "Enter one HTTP or HTTPS gallery link.")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("Enter one HTTP or HTTPS gallery link without a login or password.".into());
    }
    url.set_fragment(None);Ok(url.into())
}

fn short(value: &str, max: usize) -> String {
    value.chars().filter(|c| !c.is_control()).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}
fn scalar(meta: &Value, key: &str) -> Result<String, String> {
    let result = match meta.get(key) {
        None => String::new(), Some(Value::String(s)) => s.clone(), Some(Value::Number(n)) => n.to_string(),
        Some(Value::Null) => "None".into(), Some(Value::Bool(v)) => if *v {"True"} else {"False"}.into(),
        _ => return Err("This gallery contains unsupported item metadata.".into()),
    };
    if result.len() > 1024 || result.chars().any(char::is_control) { return Err("This gallery contains unsupported item metadata.".into()); }
    Ok(result)
}
fn media_kind(ext: &str) -> Option<&'static str> {
    if ["jpg","jpeg","png","webp","gif","avif","heic","heif","bmp","tif","tiff"].contains(&ext) { Some("image") }
    else if ["mp4","webm","mov","mkv","m4v","avi","ogv"].contains(&ext) { Some("video") }
    else if ["mp3","m4a","aac","flac","wav","ogg","opus"].contains(&ext) { Some("audio") } else { None }
}
fn hash(value: &[u8]) -> String { format!("{:x}", Sha256::digest(value)) }
fn meta_title(meta: &Value) -> String {
    ["title","description","content","filename","category"].iter().filter_map(|key| meta[*key].as_str())
        .map(|s| short(s, 180)).find(|s| !s.is_empty()).unwrap_or_else(|| "Gallery media".into())
}

fn parse_listing(source: &str, output: &[u8], stopped_at_limit: bool) -> Result<Listing, String> {
    if output.len() > MAX_OUTPUT as usize { return Err("Gallery results are too large. Use a single post or a smaller album.".into()); }
    let mut title = String::new();let mut items = Vec::new();let mut identities = Vec::new();
    let mut seen = HashSet::new();let mut truncated = stopped_at_limit;let mut records = 0;
    for line in output.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
        records += 1;if records > 2000 || line.len() > MAX_LINE { return Err("Gallery results are too large. Use a single post or a smaller album.".into()); }
        let row: Value = serde_json::from_slice(line).map_err(|_| "Gallery-dl returned an invalid preview.")?;
        let msg = row.as_array().ok_or("Gallery-dl returned an invalid preview.")?;
        match msg.first().and_then(Value::as_i64) {
            Some(-1) => return Err(failure(serde_json::to_string(msg.get(1).unwrap_or(&Value::Null)).unwrap_or_default().as_bytes())),
            Some(2) => if title.is_empty() { title = meta_title(msg.get(1).ok_or("Gallery-dl returned an invalid preview.")?); },
            Some(3) => {
                if items.len() == MAX_ITEMS { truncated = true;break; }
                let media = msg.get(1).and_then(Value::as_str).ok_or("Gallery-dl returned an invalid media link.")?;
                validate_source(media).map_err(|_| "This gallery contains a media source that cannot be downloaded safely.")?;
                let meta = msg.get(2).filter(|m| m.is_object()).ok_or("Gallery-dl returned invalid item metadata.")?;
                let mut fields = Vec::new();for key in ID_FIELDS { fields.push(scalar(meta, key)?); }
                let ext = fields[4].to_ascii_lowercase();fields[4] = ext.clone();
                let kind = media_kind(&ext).ok_or("This gallery contains an unsupported file type. Choose a photo or video post.")?;
                let identity = Identity(fields.try_into().unwrap());
                let id = hash(&serde_json::to_vec(&identity.0).map_err(|_| "Invalid gallery identity.")?);
                if !seen.insert(id.clone()) { return Err("Gallery items could not be identified uniquely. Try a direct post or album link.".into()); }
                let bytes = ["filesize","size","file_size"].iter().filter_map(|key| meta[*key].as_u64()).find(|n| *n > 0 && *n <= 100_000_000_000);
                items.push(GalleryItem {index: items.len() as u32 + 1, id, title: meta_title(meta), extension: ext, kind: kind.into(), bytes});
                identities.push(identity);
            },
            Some(6) => return Err("This gallery contains an unsupported nested collection. Use a direct post or album link.".into()),
            _ => {},
        }
    }
    if items.is_empty() { return Err("No downloadable photos or videos were found in this gallery.".into()); }
    if title.is_empty() { title = items[0].title.clone(); }
    let fingerprint = hash(&serde_json::to_vec(&(source, items.iter().map(|item| &item.id).collect::<Vec<_>>(), truncated)).unwrap());
    Ok(Listing {preview: GalleryPreview {source: source.into(),title,items,truncated,fingerprint},identities})
}

fn base_command(source: &str, options: &Options, dir: &Path, internal_metadata: bool) -> Result<Command, String> {
    let exe = executable(dir)?;let mut cmd = crate::command(&exe);
    cmd.env("PYTHONIOENCODING","utf-8").env("PYTHONUNBUFFERED","1");
    cmd.args(["--config-ignore","--no-input","--no-colors","--cache-file",":memory:",
        "--retries","2","--http-timeout","15","--range","1-201","--child-range","1-201",
        "--option","extractor.cookies-update=false","--option","extractor.skip=true"]);
    if !internal_metadata {cmd.arg("--no-postprocessors");}
    let auth = crate::resolve_auth(options.clone(),source,dir);
    if !auth.cookies.is_empty() {
        crate::cookies::validate_file(Path::new(&auth.cookies),crate::now_seconds())?;
        cmd.args(["--cookies", &auth.cookies]);
    } else if !auth.cookies_browser.is_empty() {
        if !["chrome","edge","firefox","brave","safari"].contains(&auth.cookies_browser.as_str()) { return Err("Unknown browser for cookies.".into()); }
        let host = url::Url::parse(source).unwrap().host_str().unwrap().to_owned();
        cmd.args(["--cookies-from-browser", &format!("{}/{host}",auth.cookies_browser)]);
    }
    let proxy = crate::PROXY.lock().unwrap().clone();if !proxy.is_empty() { cmd.args(["--proxy",&proxy]); }
    Ok(cmd)
}

pub fn inspect(source: &str, options: &Options, dir: &Path) -> Result<GalleryPreview, String> {
    inspect_inner(source,options,dir,&|| false,&|_| {}).map(|l| l.preview)
}
fn inspect_inner(source: &str, options: &Options, dir: &Path, cancelled: &dyn Fn()->bool, pid: &dyn Fn(u32)) -> Result<Listing,String> {
    let source = validate_source(source)?;let mut cmd = base_command(&source,options,dir,false)?;
    cmd.args(["--resolve-json","--option","output.jsonl=true","--",&source]);
    let output = run(&mut cmd,Duration::from_secs(60),cancelled,pid,&mut |_| Ok(()),true)?;
    if !output.success && !output.truncated { return Err(failure(&output.stderr)); }
    parse_listing(&source,&output.stdout,output.truncated)
}

// Every expression below is a fixed program over a literal map generated by us.
// JSON escaping keeps remote text data, never Python syntax or arbitrary code.
fn identity_expression() -> String {
    format!("({})",ID_FIELDS.iter().map(|key| format!("str(locals().get(\"{key}\",\"\")){}",if *key=="extension" {".lower()"} else {""})).collect::<Vec<_>>().join(","))
}
fn identity_literal(identity: &Identity) -> String {
    format!("({})",identity.0.iter().map(|part| serde_json::to_string(part).unwrap()).collect::<Vec<_>>().join(","))
}
fn safe_filename(item: &GalleryItem) -> String {
    let label: String = item.title.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' {c} else {'_'}).take(60).collect();
    format!("{:03}-{}-{}.{}",item.index,label.trim_matches('_'),&item.id[..16],item.extension)
}
fn selected_config(listing: &Listing, selected: &[u32], folder: &Path) -> Result<(Value,BTreeMap<String,String>),String> {
    if listing.preview.truncated { return Err("This gallery has more than 200 items. Use a smaller album or direct post link.".into()); }
    if selected.is_empty() || selected.len()>MAX_ITEMS || selected.iter().collect::<HashSet<_>>().len()!=selected.len() {
        return Err("Choose between 1 and 200 gallery items.".into());
    }
    let mut map = Vec::new();let mut names = BTreeMap::new();
    for index in selected {
        let at = index.checked_sub(1).map(|n| n as usize).filter(|n| *n<listing.preview.items.len()).ok_or("The selected gallery item no longer exists. Read the gallery again.")?;
        let item = &listing.preview.items[at];let name = safe_filename(item);
        map.push(format!("{}:{}",identity_literal(&listing.identities[at]),serde_json::to_string(&name).unwrap()));
        names.insert(name,item.id.clone());
    }
    let mapping = format!("{{{}}}",map.join(","));let identity = identity_expression();
    // Only these two app-owned metadata writers are enabled. A blanket
    // --no-postprocessors would also disable completion/skip notifications.
    let processors=["after","skip"].map(|event|json!({"name":"metadata","event":event,"filename":"-",
        "base-directory":".","content-format":format!("{FILE_MARKER}{{_path.path!j}}\n"),"open":"w","encoding":"utf-8"}));
    let config = json!({"extractor":{"base-directory":folder,"directory":[],"skip":true,"cookies-update":false,
        "postprocess":true,"postprocessors":processors,
        "file-filter":format!("{identity} in {mapping}"),"filename":format!("\u{c}E {mapping}[{identity}]")},"output":{"mode":"null"}});
    if serde_json::to_vec(&config).unwrap().len()>512*1024 { return Err("Gallery selection is too large. Choose fewer items.".into()); }
    Ok((config,names))
}

fn checked_output(folder: &Path, raw: &str, names: &BTreeMap<String,String>) -> Result<(PathBuf,String),String> {
    let path = PathBuf::from(raw);let name = path.file_name().and_then(|n| n.to_str()).ok_or("Gallery-dl returned an invalid output path.")?;
    let id = names.get(name).ok_or("Gallery-dl returned an unexpected output file.")?.clone();
    if fs::symlink_metadata(&path).map_err(|_| "The gallery output file was not found.")?.file_type().is_symlink() { return Err("The gallery output path is a symbolic link.".into()); }
    let root = folder.canonicalize().map_err(|_| "The gallery output folder could not be opened.")?;
    let path = path.canonicalize().map_err(|_| "The gallery output file could not be opened.")?;
    if !path.is_file() || path.parent()!=Some(root.as_path()) { return Err("Gallery-dl returned a file outside the selected folder.".into()); }
    Ok((path,id))
}

pub fn download(engine: &crate::Engine, job: &Job) -> Result<(),String> {
    let cancelled = || engine.shutdown.load(Ordering::Relaxed) || engine.data.lock().unwrap().jobs.iter().find(|j|j.id==job.id)
        .is_none_or(|j| ["cancelling","pausing","cancelled"].contains(&j.status.as_str()));
    let set_pid = |pid| if let Some(current)=engine.data.lock().unwrap().jobs.iter_mut().find(|j|j.id==job.id) {current.pid=Some(pid);};
    let listing = inspect_inner(&job.url,&job.options,&engine.dir,&cancelled,&set_pid)?;
    if listing.preview.fingerprint!=job.options.gallery_fingerprint { return Err("This gallery changed since its preview. Read the gallery and select the items again.".into()); }
    if !Path::new(&job.options.folder).is_absolute() { return Err("Enter the full path to the save folder.".into()); }
    fs::create_dir_all(&job.options.folder).map_err(|_| "Could not create the gallery save folder.")?;
    let base = Path::new(&job.options.folder).canonicalize().map_err(|_| "Could not open the gallery save folder.")?;
    let folder = base.join(format!("Deviload-gallery-{}",job.id));
    if folder.exists() && fs::symlink_metadata(&folder).map_err(|_| "Could not inspect the gallery save folder.")?.file_type().is_symlink() {
        return Err("The gallery save folder must not be a symbolic link.".into());
    }
    fs::create_dir_all(&folder).map_err(|_| "Could not create the gallery save folder.")?;
    let (config,names) = selected_config(&listing,&job.options.gallery_items,&folder)?;
    for name in names.keys() {
        for file in [folder.join(name),folder.join(format!("{name}.part"))] {
            if fs::symlink_metadata(&file).is_ok_and(|m| m.file_type().is_symlink()) { return Err("The gallery output path is a symbolic link.".into()); }
        }
    }
    let mut file = tempfile::NamedTempFile::new().map_err(|_| "Could not prepare the gallery selection.")?;
    file.write_all(&serde_json::to_vec(&config).unwrap()).map_err(|_| "Could not prepare the gallery selection.")?;file.flush().map_err(|_| "Could not prepare the gallery selection.")?;
    let mut cmd = base_command(&listing.preview.source,&job.options,&engine.dir,true)?;
    cmd.args(["--config-json",&file.path().to_string_lossy(),"--windows-filenames"]);
    if job.options.rate_mbps>0 { cmd.args(["--limit-rate",&format!("{}M",job.options.rate_mbps)]); }
    cmd.args(["--",&listing.preview.source]);
    let mut finished = HashSet::new();
    let mut consume = |line: &[u8]| -> Result<(),String> {
        let line = std::str::from_utf8(line).map_err(|_| "Gallery-dl returned invalid progress.")?;
        let Some(raw)=line.strip_prefix(FILE_MARKER) else {return Ok(());};
        let raw: String=serde_json::from_str(raw).map_err(|_| "Gallery-dl returned an invalid output path.")?;
        let (path,id)=checked_output(&folder,&raw,&names)?;
        if !finished.insert(id.clone()) { return Ok(()); }
        if let Some(current)=engine.data.lock().unwrap().jobs.iter_mut().find(|j|j.id==job.id) {
            let path=path.to_string_lossy().into_owned();
            current.downloads.retain(|row|row[0]!=format!("gallery {id}"));current.downloads.push([format!("gallery {id}"),path.clone()]);
            current.file=path;current.percent=finished.len() as f64/names.len() as f64*100.;current.stage="downloading".into();
            current.bytes=current.downloads.iter().filter_map(|row|fs::metadata(&row[1]).ok()).map(|m|m.len()).sum();
        }
        Ok(())
    };
    let result=run(&mut cmd,Duration::from_secs(1800),&cancelled,&set_pid,&mut consume,false)?;
    if !result.success { return Err(failure(&result.stderr)); }
    if finished.len()!=names.len() { return Err("Some selected gallery items were not saved. Read the gallery again or check access to the post.".into()); }
    Ok(())
}

struct ChildOutput {success:bool,stdout:Vec<u8>,stderr:Vec<u8>,truncated:bool}
fn run(cmd:&mut Command, timeout:Duration, cancelled:&dyn Fn()->bool, pid:&dyn Fn(u32), line:&mut dyn FnMut(&[u8])->Result<(),String>, listing:bool) -> Result<ChildOutput,String> {
    let output_file=tempfile::NamedTempFile::new().map_err(|_| "Could not start gallery-dl.")?;
    let error_file=tempfile::NamedTempFile::new().map_err(|_| "Could not start gallery-dl.")?;
    // Reopen, rather than duplicate: parent polling must have an independent file
    // position so it cannot move the child's stdout/stderr write cursor.
    let mut stdout=output_file.reopen().map_err(|_| "Could not start gallery-dl.")?;
    let mut stderr=error_file.reopen().map_err(|_| "Could not start gallery-dl.")?;
    cmd.stdin(Stdio::null()).stdout(output_file.reopen().map_err(|_| "Could not start gallery-dl.")?)
        .stderr(error_file.reopen().map_err(|_| "Could not start gallery-dl.")?);
    #[cfg(unix)] {use std::os::unix::process::CommandExt;cmd.process_group(0);}
    let mut child=cmd.spawn().map_err(|_| "Gallery-dl could not start. Check that its optional engine is installed.")?;pid(child.id());
    let started=Instant::now();let mut bytes=Vec::new();let mut offset=0;let mut urls=0;let mut truncated=false;
    let outcome=(||->Result<_,String>{loop {
        if cancelled() {return Err("Gallery download cancelled.".into());}
        if started.elapsed()>timeout {return Err("Gallery-dl did not respond in time. Use a smaller album or check the connection.".into());}
        let length=stdout.metadata().map_err(|_| "Could not read gallery results.")?.len();
        if length>MAX_OUTPUT || stderr.metadata().map_err(|_| "Could not read gallery status.")?.len()>MAX_OUTPUT {return Err("Gallery results are too large. Use a smaller album or direct post link.".into());}
        stdout.seek(SeekFrom::Start(bytes.len() as u64)).map_err(|_| "Could not read gallery results.")?;
        Read::by_ref(&mut stdout).take(MAX_OUTPUT+1-bytes.len() as u64).read_to_end(&mut bytes).map_err(|_| "Could not read gallery results.")?;
        if bytes.len()>MAX_OUTPUT as usize {return Err("Gallery results are too large. Use a smaller album or direct post link.".into());}
        while let Some(end)=bytes[offset..].iter().position(|b|*b==b'\n').map(|n|offset+n) {
            let row=&bytes[offset..end];if row.len()>MAX_LINE {return Err("Gallery-dl returned an oversized record.".into());}
            if listing && serde_json::from_slice::<Value>(row).ok().and_then(|v|v[0].as_i64())==Some(3) {urls+=1;if urls>MAX_ITEMS {truncated=true;return Ok(None);}}
            line(row)?;offset=end+1;
        }
        if bytes.len()-offset>MAX_LINE {return Err("Gallery-dl returned an oversized record.".into());}
        match child.try_wait() {Ok(Some(status))=>{return Ok(Some(status));},Ok(None)=>thread::sleep(Duration::from_millis(50)),Err(_)=>return Err("Gallery-dl stopped unexpectedly.".into())}
    }})();
    match outcome {
        Ok(Some(status))=>{
            // Flush the last output written between polling and process exit.
            if stderr.metadata().map_err(|_| "Could not read gallery status.")?.len()>MAX_OUTPUT {return Err("Gallery results are too large. Use a smaller album or direct post link.".into());}
            stdout.seek(SeekFrom::Start(bytes.len() as u64)).map_err(|_| "Could not read gallery results.")?;
            Read::by_ref(&mut stdout).take(MAX_OUTPUT+1-bytes.len() as u64).read_to_end(&mut bytes).map_err(|_| "Could not read gallery results.")?;
            if bytes.len()>MAX_OUTPUT as usize {return Err("Gallery results are too large. Use a smaller album or direct post link.".into());}
            for row in bytes[offset..].split(|b|*b==b'\n').filter(|row|!row.is_empty()) {
                if row.len()>MAX_LINE{return Err("Gallery-dl returned an oversized record.".into());}
                if listing && serde_json::from_slice::<Value>(row).ok().and_then(|v|v[0].as_i64())==Some(3) {urls+=1;if urls>MAX_ITEMS {truncated=true;break;}}
                line(row)?;
            }
            stderr.seek(SeekFrom::Start(0)).map_err(|_| "Could not read gallery status.")?;let mut errors=Vec::new();stderr.take(65536).read_to_end(&mut errors).map_err(|_| "Could not read gallery status.")?;
            Ok(ChildOutput {success:status.success()&&!truncated,stdout:bytes,stderr:errors,truncated})
        },
        other=>{
            crate::kill_tree(child.id());let _=child.kill();let _=child.wait();
            match other {Ok(None)=>Ok(ChildOutput {success:false,stdout:bytes,stderr:vec![],truncated}),Err(error)=>Err(error),_=>unreachable!()}
        }
    }
}
fn failure(raw:&[u8])->String {
    let detail=String::from_utf8_lossy(raw).to_ascii_lowercase();
    if detail.contains("noextractor") || detail.contains("unsupported url") {"Gallery-dl does not support this link."}
    else if ["authrequired","authentication","login","cookies","sign in"].iter().any(|key|detail.contains(key)) {"This gallery requires sign-in. Choose cookies from the browser or a fresh cookies.txt file."}
    else if detail.contains("429") || detail.contains("rate limit") {"This gallery is limiting requests. Wait before retrying."}
    else {"Gallery download failed. Check the link, access to the post, and the connection."}.into()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn listing() -> Listing {
        parse_listing("https://example.com/album",concat!(
            "[2,{\"title\":\"Example album\"}]\n",
            "[3,\"https://cdn.example.com/one.jpg?token=private\",{\"category\":\"test\",\"id\":1,\"filename\":\"one\",\"num\":1,\"extension\":\"jpg\",\"title\":\"First photo\",\"filesize\":123}]\n",
            "[3,\"https://cdn.example.com/two.mp4\",{\"category\":\"test\",\"id\":2,\"filename\":\"two\",\"num\":2,\"extension\":\"mp4\"}]\n").as_bytes(),false).unwrap()
    }
    #[test]
    fn gallery_urls_are_http_only_without_credentials_or_extractor_commands() {
        for value in ["file:///secret","https://user:password@example.com/x","data:text/plain,test","direct:https://example.com/x","--exec calc","https://example.com/x\n--exec"] {assert!(validate_source(value).is_err());}
        assert_eq!(validate_source("https://example.com/x#one").unwrap(),"https://example.com/x");
    }
    #[test]
    fn preview_keeps_order_types_and_sizes_but_never_direct_urls_or_account_data() {
        let list=listing();let text=serde_json::to_string(&list.preview).unwrap();
        assert_eq!(list.preview.items.len(),2);assert_eq!(list.preview.items[1].kind,"video");assert_eq!(list.preview.items[0].bytes,Some(123));
        assert_eq!(list.preview.fingerprint.len(),64);assert!(!text.contains("cdn.example")&&!text.contains("private")&&!text.contains("token"));
    }
    #[test]
    fn selection_names_and_filters_are_stable_and_reject_changed_or_ambiguous_items() {
        let list=listing();let (config,names)=selected_config(&list,&[2],Path::new("/downloads/gallery")).unwrap();
        assert_eq!(names.len(),1);assert!(names.keys().next().unwrap().ends_with(".mp4"));
        assert!(config["extractor"]["file-filter"].as_str().unwrap().contains("locals().get"));
        assert!(selected_config(&list,&[1,1],Path::new("/x")).is_err());assert!(selected_config(&list,&[3],Path::new("/x")).is_err());
        let duplicate=b"[3,\"https://cdn.example/a.jpg\",{\"id\":1,\"extension\":\"jpg\"}]\n[3,\"https://cdn.example/b.jpg\",{\"id\":1,\"extension\":\"jpg\"}]\n";
        assert!(parse_listing("https://example.com",duplicate,false).unwrap_err().contains("uniquely"));
    }
    #[test]
    fn selection_literals_cannot_turn_remote_titles_into_python_or_paths() {
        let raw=json!([3,"https://cdn.example/photo.jpg",{"category":"example","id":"\");__import__('os').system('bad')#","filename":"../../bad","extension":"jpg","title":"../../escape"}]);
        let list=parse_listing("https://example.com",format!("{raw}\n").as_bytes(),false).unwrap();
        let (config,names)=selected_config(&list,&[1],Path::new("/downloads/gallery")).unwrap();
        assert!(names.keys().all(|name|!name.contains('/')&&!name.contains('\\')&&!name.contains("..")));
        assert!(config["extractor"]["file-filter"].as_str().unwrap().contains("\\\""));
    }
    #[test]
    fn unsafe_media_errors_nested_collections_and_excess_output_fail_closed() {
        for row in [json!([3,"file:///secret",{"extension":"jpg"}]),json!([3,"https://example.com/a",{"extension":"html"}]),json!([6,"https://example.com/next",{}]),json!([-1,{"error":"AuthRequired","message":"secret cookie and URL"}])] {
            let error=parse_listing("https://example.com",format!("{row}\n").as_bytes(),false).err().unwrap();assert!(!error.contains("secret"));
        }
        let mut list=listing();list.preview.truncated=true;assert!(selected_config(&list,&[1],Path::new("/x")).is_err());
    }
    #[test]
    fn output_paths_are_existing_expected_files_inside_the_exact_task_folder() {
        let temp=tempfile::tempdir().unwrap();let folder=temp.path().join("gallery");fs::create_dir(&folder).unwrap();
        let names=BTreeMap::from([("photo.jpg".into(),"id".into())]);let inside=folder.join("photo.jpg");fs::write(&inside,b"image fixture").unwrap();
        assert!(checked_output(&folder,&inside.to_string_lossy(),&names).is_ok());
        let outside=temp.path().join("photo.jpg");fs::write(&outside,b"outside").unwrap();assert!(checked_output(&folder,&outside.to_string_lossy(),&names).is_err());
    }
    #[test]
    fn image_revisions_are_distinct_but_refreshed_signed_urls_keep_the_selection() {
        let row=|timestamp:&str,token:&str|json!([3,format!("https://cdn.example/image.jpg?token={token}"),
            {"category":"wikimediacommons","filename":"Example","num":1,"extension":"jpg","timestamp":timestamp,"sha1":"same-image"}]);
        let old=parse_listing("https://example.com",format!("{}\n{}\n",row("2010-03-14","a"),row("2006-03-07","b")).as_bytes(),false).unwrap();
        let refreshed=parse_listing("https://example.com",format!("{}\n{}\n",row("2010-03-14","c"),row("2006-03-07","d")).as_bytes(),false).unwrap();
        assert_ne!(old.preview.items[0].id,old.preview.items[1].id);assert_eq!(old.preview.fingerprint,refreshed.preview.fingerprint);
        let reordered=parse_listing("https://example.com",format!("{}\n{}\n",row("2006-03-07","a"),row("2010-03-14","b")).as_bytes(),false).unwrap();
        assert_ne!(old.preview.fingerprint,reordered.preview.fingerprint);
    }
    fn fixture_command(mode:&str)->Command {
        let mut cmd=crate::command(&std::env::current_exe().unwrap());
        cmd.args(["--exact","gallery::tests::gallery_child_fixture","--nocapture"])
            .env("DEVI_GALLERY_TEST_CHILD",mode);cmd
    }
    #[test]
    fn gallery_child_fixture() {
        let Ok(mode)=std::env::var("DEVI_GALLERY_TEST_CHILD") else{return;};
        match mode.as_str() {
            "sleep"=>thread::sleep(Duration::from_secs(15)),
            "many"=>for _ in 0..203 {println!("[3,\"https://example.com/photo.jpg\",{{\"extension\":\"jpg\"}}]");},
            "oversized"=>println!("{}","x".repeat(MAX_LINE+1)),
            _=>panic!("Unknown gallery test fixture"),
        }
    }
    #[test]
    fn child_cancellation_and_deadline_terminate_the_process_promptly() {
        let started=Instant::now();
        let error=run(&mut fixture_command("sleep"),Duration::from_secs(5),&||started.elapsed()>Duration::from_millis(100),&|_|{},&mut |_|Ok(()),false).err().unwrap();
        assert!(error.contains("cancelled"));assert!(started.elapsed()<Duration::from_secs(5));
        let started=Instant::now();
        let error=run(&mut fixture_command("sleep"),Duration::from_millis(100),&||false,&|_|{},&mut |_|Ok(()),false).err().unwrap();
        assert!(error.contains("in time"));assert!(started.elapsed()<Duration::from_secs(5));
    }
    #[test]
    fn child_listing_and_record_limits_bound_extraction_output() {
        let output=run(&mut fixture_command("many"),Duration::from_secs(5),&||false,&|_|{},&mut |_|Ok(()),true).unwrap();
        assert!(output.truncated);assert!(!output.success);assert!(output.stdout.len()<MAX_OUTPUT as usize);
        let error=run(&mut fixture_command("oversized"),Duration::from_secs(5),&||false,&|_|{},&mut |_|Ok(()),true).err().unwrap();
        assert!(error.contains("oversized"));
    }
    // An explicit developer probe, never a dependency of the ordinary local suite.
    // Use an isolated directory containing the separately verified optional engine.
    #[test]
    fn public_gallery_roundtrip_when_explicitly_requested() {
        let Ok(root)=std::env::var("DEVI_GALLERY_PUBLIC_PROBE_ROOT") else{return;};
        let dir=PathBuf::from(root);assert!(dir.join("engines/gallery-dl.exe").is_file()||dir.join("engines/gallery-dl").is_file());
        let output=dir.join(format!("public-output-\u{42e}\u{43d}\u{438}\u{43a}\u{43e}\u{434}-{}",crate::now_seconds()));fs::create_dir_all(&output).unwrap();
        let source="https://commons.wikimedia.org/wiki/File:Example.jpg";
        let mut options=Options {folder:output.to_string_lossy().into(),..Options::default()};
        let preview=inspect(source,&options,&dir).unwrap();assert!(!preview.truncated&&!preview.items.is_empty());
        options.download_engine="gallery-dl".into();options.gallery_items=vec![1];options.gallery_fingerprint=preview.fingerprint.clone();
        let job=Job {id:91001,url:source.into(),options,status:"downloading".into(),..Job::default()};
        let engine=crate::Engine {data:std::sync::Arc::new(std::sync::Mutex::new(crate::Snapshot {jobs:vec![job.clone()],..crate::Snapshot::default()})),dir:dir.clone(),shutdown:std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false))};
        download(&engine,&job).unwrap();
        let saved=engine.data.lock().unwrap().jobs[0].clone();assert_eq!(saved.downloads.len(),1);assert_eq!(saved.percent,100.);
        let file=PathBuf::from(&saved.file);let first=fs::metadata(&file).unwrap();let digest=hash(&fs::read(&file).unwrap());
        assert!(first.len()>1000);assert_eq!(first.len(),preview.items[0].bytes.unwrap());
        download(&engine,&job).unwrap();
        assert_eq!(hash(&fs::read(&file).unwrap()),digest);assert_eq!(fs::metadata(&file).unwrap().modified().unwrap(),first.modified().unwrap());
        assert_eq!(engine.data.lock().unwrap().jobs[0].downloads.len(),1);
        fs::write(dir.join("public-roundtrip-proof.json"),serde_json::to_vec_pretty(&json!({"source":source,"engineVersion":info(&dir).version,"itemsInPreview":preview.items.len(),"selectedItems":1,"savedFile":file,"bytes":first.len(),"sha256":digest,"repeatSkippedWithoutOverwrite":true})).unwrap()).unwrap();
    }
}
