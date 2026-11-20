/* Conexão do passador de slides (celular <-> apresentação) – Escuderia Vanguarda
   Usa vários caminhos ao mesmo tempo para não cair:
   1) MQTT por WebSocket em dois servidores públicos (sem limite de mensagens)
   2) ntfy.sh como reserva (só é usado quando o MQTT não alcança o outro lado)
   Cada mensagem tem um id: se chegar repetida por dois caminhos, é usada só uma vez. */
(function(){
'use strict';
const BROKERS=window.VG_BROKERS||['wss://broker.emqx.io:8084/mqtt','wss://broker.hivemq.com:8884/mqtt'];
const NTFY=window.VG_NTFY||'https://ntfy.sh/';
const enc=new TextEncoder(),dec=new TextDecoder();

/* ---------- cliente MQTT 3.1.1 mínimo (QoS 0) ---------- */
function str(s){const b=enc.encode(s);return [b.length>>8,b.length&255,...b];}
function pkt(type,body){const out=[type];let n=body.length;do{let d=n%128;n=Math.floor(n/128);if(n>0)d|=128;out.push(d);}while(n>0);return new Uint8Array([...out,...body]);}
function Mqtt(url,subs,onMsg,onState){
  let ws=null,buf=new Uint8Array(0),ping=null,wd=null,retry=0,timer=null,alive=false,stopped=false,lastIn=0;
  const cid='vg'+Math.random().toString(36).slice(2,12);
  function connect(){
    clearTimeout(timer);if(stopped)return;
    let sock;try{sock=new WebSocket(url,'mqtt');}catch(e){return later();}
    ws=sock;sock.binaryType='arraybuffer';buf=new Uint8Array(0);
    const to=setTimeout(()=>{if(ws===sock&&!alive)try{sock.close();}catch(e){}},8000);
    sock.onopen=()=>{if(ws===sock)sock.send(pkt(0x10,[...str('MQTT'),4,2,0,30,...str(cid)]));};
    sock.onmessage=ev=>{if(ws!==sock)return;lastIn=Date.now();const d=new Uint8Array(ev.data),nb=new Uint8Array(buf.length+d.length);nb.set(buf);nb.set(d,buf.length);buf=nb;parse();};
    sock.onclose=sock.onerror=()=>{clearTimeout(to);if(ws===sock)down();};
  }
  function parse(){
    for(;;){
      if(buf.length<2)return;
      let mul=1,len=0,i=1,b;
      do{if(i>=buf.length)return;b=buf[i++];len+=(b&127)*mul;mul*=128;}while(b&128);
      if(buf.length<i+len)return;
      const t=buf[0]>>4,flags=buf[0]&15,body=buf.subarray(i,i+len);buf=buf.slice(i+len);
      if(t===2){ // CONNACK
        if(body[1]!==0){try{ws.close();}catch(e){}return;}
        alive=true;retry=0;let pid=1;
        for(const s of subs)ws.send(pkt(0x82,[0,pid++,...str(s),0]));
        clearInterval(ping);ping=setInterval(()=>{try{ws.send(new Uint8Array([0xC0,0]));}catch(e){}},15000);
        clearInterval(wd);wd=setInterval(()=>{if(Date.now()-lastIn>40000)try{ws.close();}catch(e){}},5000);
        onState(true);
      }else if(t===3){ // PUBLISH
        const tl=(body[0]<<8)|body[1],topic=dec.decode(body.subarray(2,2+tl));let p=2+tl;if((flags>>1)&3)p+=2;
        try{onMsg(topic,dec.decode(body.subarray(p)));}catch(e){}
      }
    }
  }
  function down(){
    const was=alive;alive=false;clearInterval(ping);clearInterval(wd);ws=null;
    if(was)onState(false);later();
  }
  function later(){if(stopped)return;clearTimeout(timer);timer=setTimeout(connect,Math.min(5000,600*Math.pow(1.6,retry++)));}
  connect();
  return{
    get ok(){return alive&&ws&&ws.readyState===1;},
    pub(topic,msg,retain){if(!this.ok)return false;try{ws.send(pkt(retain?0x31:0x30,[...str(topic),...enc.encode(msg)]));return true;}catch(e){return false;}},
    kick(){if(!this.ok&&!stopped){retry=0;if(ws){try{ws.close();}catch(e){}}else connect();}},
    stop(){stopped=true;try{ws&&ws.close();}catch(e){}}
  };
}

/* ---------- ntfy.sh (reserva) ---------- */
function Ntfy(topic,onMsg,onState){
  let es=null,last=0,ok=false,wd=null,stopped=false;
  function open(){
    if(stopped)return;try{es&&es.close();}catch(e){}
    try{es=new EventSource(NTFY+topic+'/sse');}catch(e){es=null;return;}
    last=Date.now();
    es.onopen=()=>{last=Date.now();if(!ok){ok=true;onState(true);}};
    es.onmessage=ev=>{last=Date.now();let m;try{m=JSON.parse(ev.data);}catch(e){return;}if(m.event==='message')onMsg(m.message);};
    es.onerror=()=>{if(ok){ok=false;onState(false);}};
  }
  open();
  wd=setInterval(()=>{if(!stopped&&(!es||es.readyState===2||Date.now()-last>95000))open();},10000); // ntfy manda "keepalive" a cada ~45 s
  return{get ok(){return ok&&es&&es.readyState===1;},kick(){if(!this.ok)open();},stop(){stopped=true;clearInterval(wd);try{es&&es.close();}catch(e){}}};
}

/* ---------- canal completo ---------- */
// side 'pc' recebe comandos (c) e envia estado (s); side 'cel' faz o contrário
window.VGRelay=function(room,side,onMessage,onStatus){
  const base='vanguarda/'+room+'/',inT=base+(side==='pc'?'c':'s'),outT=base+(side==='pc'?'s':'c');
  const nIn='vanguarda-'+room+'-'+(side==='pc'?'c':'s'),nOut='vanguarda-'+room+'-'+(side==='pc'?'s':'c');
  const seen=[],seenSet=new Set();let peerMqtt=0,peerAny=0,lastNtfyPub=0;
  function got(raw,via){
    let m;try{m=JSON.parse(raw);}catch(e){return;}
    if(!m||typeof m!=='object')return;
    const now=Date.now();peerAny=now;if(via==='mqtt')peerMqtt=now;
    let dup=false;
    if(m.id){if(seenSet.has(m.id))dup=true;else{seenSet.add(m.id);seen.push(m.id);if(seen.length>300)seenSet.delete(seen.shift());}}
    onMessage(m,dup,via);status();
  }
  const mq=BROKERS.map(u=>Mqtt(u,[inT],(t,p)=>got(p,'mqtt'),status));
  const nt=Ntfy(nIn,p=>got(p,'ntfy'),status);
  function anyOpen(){return mq.some(c=>c.ok)||nt.ok;}
  function status(){if(onStatus)onStatus({open:anyOpen(),mqtt:mq.some(c=>c.ok),peer:peerAny});}
  function send(obj,opts){
    opts=opts||{};if(!obj.id)obj.id=Math.random().toString(36).slice(2,11);
    const s=JSON.stringify(obj);let sent=0;
    for(const c of mq)if(c.pub(outT,s,!!opts.retain))sent++;
    // ntfy só quando o MQTT não está chegando no outro lado (economiza o limite diário dele)
    const now=Date.now(),needN=opts.force||!sent||now-peerMqtt>12000;
    if(needN&&now-lastNtfyPub>=(opts.ntfyEvery||0)){lastNtfyPub=now;fetch(NTFY+nOut,{method:'POST',body:s}).catch(()=>{});sent++;}
    return obj.id;
  }
  function kick(){mq.forEach(c=>c.kick());nt.kick();}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')kick();});
  addEventListener('online',kick);addEventListener('pageshow',kick);
  setInterval(status,2000);
  return{send,kick,get open(){return anyOpen();},get peer(){return peerAny;},stop(){mq.forEach(c=>c.stop());nt.stop();}};
};
})();
