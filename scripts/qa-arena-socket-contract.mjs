import { io } from 'socket.io-client';
const BASE='http://localhost:3001';
const login=async e=>{const r=await fetch(`${BASE}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'Password123!'})});return (await r.json()).data.access_token;};
const wait=(s,ev,ms=6000)=>new Promise(res=>{const t=setTimeout(()=>res({ev:'TIMEOUT'}),ms);s.once(ev,d=>{clearTimeout(t);res({ev,d});});});
const results={};

// 1. unauthenticated connection must be rejected
{
  const s=io(`${BASE}/arena`,{transports:['websocket'],reconnection:false});
  const r=await Promise.race([wait(s,'arena:error',5000),wait(s,'disconnect',5000)]);
  results.UNAUTH_REJECTED = r.ev!=='TIMEOUT';
  console.log(`unauthenticated -> ${r.ev} ${JSON.stringify(r.d??'')}`);
  s.close();
}
// 2. authenticated queue then cancel (no opponent -> no match, no currency moved)
{
  const tok=await login('student1@breadtrans.com');
  const s=io(`${BASE}/arena`,{transports:['websocket'],reconnection:false,auth:{token:tok}});
  const c=await wait(s,'connect',6000);
  console.log(`authenticated connect -> ${c.ev}`);
  results.AUTH_CONNECT = c.ev==='connect';
  const bal=await (await fetch(`${BASE}/market/currency/balance`,{headers:{Authorization:`Bearer ${tok}`}})).json(); console.log('balance:',JSON.stringify(bal.data));
  const me=await (await fetch(`${BASE}/users/me`,{headers:{Authorization:`Bearer ${tok}`}})).json();
  const uid=me.data?.id;
  s.emit('join_queue',{userId:uid,userName:'qa',stake:10,gameId:'vocab-duel'});
  const w=await Promise.race([wait(s,'arena:waiting',7000),wait(s,'arena:match_found',7000),wait(s,'arena:error',7000)]);
  console.log(`join_queue -> ${w.ev} ${JSON.stringify(w.d??'')}`);
  results.QUEUE_ACCEPTED = w.ev==='arena:waiting'||w.ev==='arena:match_found';
  s.emit('cancel_queue',{userId:uid});
  const cx=await Promise.race([wait(s,'arena:cancelled',7000)]);
  console.log(`cancel_queue -> ${cx.ev} ${JSON.stringify(cx.d??'')}`);
  results.QUEUE_CANCELLED = cx.ev==='arena:cancelled';
  s.close();
}
console.log('\n'+Object.entries(results).map(([k,v])=>`${k}=${v}`).join('\n'));
process.exit(0);
