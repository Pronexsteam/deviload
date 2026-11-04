//! Process-local, memory-only protection state. No IDs or reason payloads enter diagnostic reports.
use std::collections::HashMap;

#[derive(Clone,Copy,Debug,PartialEq)]
pub enum Reason { Pending, Required, Rejected, Unknown, Restricted, Limited, InvalidResponse }
impl Reason {
    pub fn parse(value:&str,detail:Option<&str>)->Option<Self>{match value{"pending"=>Some(Self::Pending),"required"=>Some(Self::Required),"rejected"=>Some(Self::Rejected),"unknown" if detail==Some("invalid_response")=>Some(Self::InvalidResponse),"unknown"=>Some(Self::Unknown),"restricted"=>Some(Self::Restricted),"limited"=>Some(Self::Limited),_=>None}}
    pub fn message(self)->&'static str{match self{
        Self::Pending=>"Playback verification is pending. Wait, then select the track again.",
        Self::Required=>"Playback restricted: YouTube requires stream verification. Try another track.",
        Self::Rejected=>"Playback restricted: YouTube rejected stream verification. Try another track.",
        Self::Unknown=>"Playback restricted: YouTube reported an unknown stream protection state. Try another track.",
        Self::Restricted=>"Playback restricted: YouTube denied access to the audio. Try another track.",
        Self::Limited=>"Playback temporarily limited by YouTube. Wait before trying again.",
        Self::InvalidResponse=>"Invalid music engine response: missing or unknown playability status",
    }}
}
#[derive(Default)]
pub struct ProtectionGuard { entries:HashMap<String,(Reason,Option<String>)>, overflow:bool }
impl ProtectionGuard {
    pub fn note(&mut self,id:&str,reason:Reason){
        if id.len()!=11||!id.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'_'||c==b'-'){return;}
        if self.entries.len()>=64&&!self.entries.contains_key(id){self.overflow=true;return;}
        self.entries.insert(id.into(),(reason,None));
    }
    pub fn verification(&mut self,id:&str,attempt:&str,waiting:bool){
        if attempt.len()!=36||!attempt.bytes().all(|c|c.is_ascii_hexdigit()||c==b'-'){return;}
        if waiting {
            if self.entries.contains_key(id){return;}
            self.note(id,Reason::Pending);
            if let Some(entry)=self.entries.get_mut(id){entry.1=Some(attempt.into());}
        } else if self.entries.get(id).is_some_and(|e|e.0==Reason::Pending&&e.1.as_deref()==Some(attempt)){self.entries.remove(id);}
    }
    pub fn recovery_error(&self,id:&str)->Option<String>{self.entries.get(id).map(|e|e.0).or(self.overflow.then_some(Reason::Unknown)).map(|reason|reason.message().into())}
    // A fresh foreground request may retry the primary. Automatic recovery/preload must not clear it.
    pub fn begin_play(&mut self,id:&str,automatic:bool)->Result<(),String>{
        if automatic {if let Some(reason)=self.recovery_error(id){return Err(reason);}} else {self.new_primary(id);}
        Ok(())
    }
    pub fn new_primary(&mut self,id:&str){self.entries.remove(id);}
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn incomplete_playability_blocks_reserve_until_a_new_primary_selection(){
        let mut guard=ProtectionGuard::default();
        assert_eq!(Reason::parse("unknown",None),Some(Reason::Unknown));
        assert_eq!(Reason::parse("restricted",Some("invalid_response")),Some(Reason::Restricted));
        let reason=Reason::parse("unknown",Some("invalid_response")).unwrap();let id="abcdefghijk";
        guard.note(id,reason);
        assert_eq!(guard.recovery_error(id).as_deref(),Some("Invalid music engine response: missing or unknown playability status"));
        guard.new_primary(id);assert!(guard.recovery_error(id).is_none());
    }
    #[test]fn only_the_waiting_transport_may_unblock_recovery(){
        let mut guard=ProtectionGuard::default();let id="abcdefghijk";let a="00000000-0000-0000-0000-000000000001";let b="00000000-0000-0000-0000-000000000002";
        guard.verification(id,a,true);guard.verification(id,b,false);assert!(guard.recovery_error(id).is_some());
        guard.verification(id,a,false);assert!(guard.recovery_error(id).is_none());
        guard.verification(id,b,true);guard.note(id,Reason::Required);guard.verification(id,b,false);assert_eq!(guard.recovery_error(id).unwrap(),Reason::Required.message());
    }
    #[test]fn pending_blocks_recovery_but_is_not_a_permanent_denial(){let mut guard=ProtectionGuard::default();guard.note("abcdefghijk",Reason::Pending);let message=guard.recovery_error("abcdefghijk").unwrap();assert!(message.contains("pending"));assert!(!message.contains("denied"));assert!(guard.recovery_error("othertrack1").is_none());guard.new_primary("abcdefghijk");assert!(guard.recovery_error("abcdefghijk").is_none());}
    #[test]fn automatic_play_cannot_reset_a_guard_recorded_after_admission(){
        let id="abcdefghijk";
        for reason in [Reason::Pending,Reason::Rejected,Reason::Required,Reason::Restricted,Reason::Limited,Reason::InvalidResponse,Reason::Unknown]{
            let mut guard=ProtectionGuard::default();
            guard.begin_play(id,true).unwrap();
            guard.note(id,reason);
            assert_eq!(guard.begin_play(id,true).unwrap_err(),reason.message());
            assert_eq!(guard.recovery_error(id).as_deref(),Some(reason.message()));
            guard.begin_play(id,false).unwrap();
            assert!(guard.recovery_error(id).is_none());
        }
    }
    #[test]fn every_protection_state_survives_automatic_recovery(){for reason in [Reason::Pending,Reason::Required,Reason::Rejected,Reason::Unknown,Reason::Restricted,Reason::Limited]{let mut guard=ProtectionGuard::default();guard.note("abcdefghijk",reason);for _ in 0..3{assert_eq!(guard.recovery_error("abcdefghijk"),Some(reason.message().into()));}}}
    #[test]fn malformed_control_messages_are_ignored_and_capacity_fails_closed(){let mut guard=ProtectionGuard::default();guard.note("https://secret",Reason::Pending);assert!(guard.entries.is_empty());assert_eq!(Reason::parse("token=secret",None),None);for index in 0..65{guard.note(&format!("{index:011}"),Reason::Required);}assert_eq!(guard.entries.len(),64);assert!(guard.recovery_error("abcdefghijk").is_some());}
}
