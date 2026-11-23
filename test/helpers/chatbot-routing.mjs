import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=process.argv[2];
process.env.ZOOM_ACCOUNT_ID='your_zoom_account_id_here';
process.env.ZOOM_BOT_JID='configured-bot@xmpp.zoom.us';
process.env.ZOOM_CLIENT_ID='runtime-id';process.env.ZOOM_CLIENT_SECRET='runtime-secret';
const {withChatbotEvent}=await import(pathToFileURL(path.join(root,'backend/utils/zoom/chatbot-context.js')));
const {sendChatMessage,editChatbotMessage}=await import(pathToFileURL(path.join(root,'backend/utils/zoom/zoom-api.js')));
const requests=[];
globalThis.fetch=async(url,init)=>{
 if(url.endsWith('/oauth/token'))return Response.json({access_token:'mock-token'});
 requests.push({method:init.method,body:JSON.parse(init.body)});
 return Response.json({message_id:'mock-message'});
};
await Promise.all(['one','two'].map((id,i)=>withChatbotEvent({accountId:'account-'+id,robotJid:'bot-'+id+'@xmpp.zoom.us',userJid:'user-'+id+'@xmpp.zoom.us'},async()=>{
 await new Promise(resolve=>setTimeout(resolve,i?1:10));
 await sendChatMessage('channel-'+id+'@conference.xmpp.zoom.us',{head:{text:id}},'thread-'+id);
 await editChatbotMessage('message-'+id,null,{head:{text:id}});
})));
assert.equal(requests.length,4);
for(const request of requests){
 const b=request.body,id=b.content.head.text;
 assert.equal(b.account_id,'account-'+id);assert.equal(b.robot_jid,'bot-'+id+'@xmpp.zoom.us');assert.equal(b.user_jid,'user-'+id+'@xmpp.zoom.us');
 if(request.method==='POST'){assert.equal(b.to_jid,'channel-'+id+'@conference.xmpp.zoom.us');assert.equal(b.reply_to,'thread-'+id);}
}
await withChatbotEvent({accountId:'account-dm',userJid:'user-dm@xmpp.zoom.us'},()=>sendChatMessage('user-dm@xmpp.zoom.us',{}));
assert.equal(requests.at(-1).body.user_jid,'user-dm@xmpp.zoom.us');
const count=requests.length;
await assert.rejects(sendChatMessage('user@xmpp.zoom.us',{}),/no valid account ID/);
assert.equal(requests.length,count);
console.log('Verified event account, bot identity, channel acting user, threading, concurrent isolation, and placeholder rejection');
