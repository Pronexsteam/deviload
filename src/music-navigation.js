// Keep only route descriptors, never catalog results, images or player state.
export function createMusicNavigation(initial,limit=20){
  let current=initial;const history=[];
  return {
    visit(next){if(JSON.stringify(next)===JSON.stringify(current))return;history.push(current);if(history.length>limit)history.shift();current=next;},
    back(){if(!history.length)return null;current=history.pop();return current;},
    canGoBack(){return history.length>0;}
  };
}
