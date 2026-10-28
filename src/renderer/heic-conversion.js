(function(){
var $=function(i){return document.getElementById(i)};
var items=[],busy=false;
var drop=$('drop'),file=$('file'),heicFormat=$('heic-fmt'),replaceHeic=$('replace-heic'),list=$('list'),msg=$('msg');

drop.onclick=function(){file.click()};
drop.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click()}};
['dragover','dragenter'].forEach(function(n){drop.addEventListener(n,function(e){e.preventDefault();drop.classList.add('on')})});
['dragleave','drop'].forEach(function(n){drop.addEventListener(n,function(e){e.preventDefault();drop.classList.remove('on')})});
drop.addEventListener('drop',function(e){add(e.dataTransfer.files)});
file.onchange=function(){add(file.files);file.value=''};

function add(fs){
  Array.prototype.forEach.call(fs,function(f){
    if(!/\.(heic|heif)$/i.test(f.name)&&!/hei[cf]/i.test(f.type)) return;
    var filePath=null,pathError='';
    try{filePath=window.api.getPathForFile(f)}catch(error){pathError=error.message}
    items.push({f:f,path:filePath,pathError:pathError,out:null,replaced:false,name:'',state:'Na fila',cls:''});
  });
  render();
}

function render(){
  list.innerHTML='';
  items.forEach(function(it){
    var li=document.createElement('li');
    var img=document.createElement('img');img.className='th';img.alt='';
    if(it.thumb)img.src=it.thumb;
    var d=document.createElement('div');d.className='in';
    var n=document.createElement('div');n.className='nm';n.textContent=it.replaced?it.name:it.f.name;
    var s=document.createElement('div');s.className='st '+it.cls;s.textContent=it.state;
    d.appendChild(n);d.appendChild(s);
    li.appendChild(img);li.appendChild(d);
    if(it.out&&!it.replaced){
      var b=document.createElement('button');b.textContent='Salvar';
      b.onclick=function(){save(it)};
      li.appendChild(b);
    }
    list.appendChild(li);
  });
  var hasItems=items.length>0,pending=items.some(function(x){return !x.replaced}),done=items.some(function(x){return x.out&&!x.replaced});
  $('go').disabled=!pending||busy;
  $('all').disabled=!done||busy;
  $('clr').disabled=!hasItems||busy;
  heicFormat.disabled=busy;
  replaceHeic.disabled=busy;
}

async function convert(it,format){
  var result=await window.api.convertHeic(await it.f.arrayBuffer(),format);
  var type=format==='jpg'?'image/jpeg':'image/png';
  var out=new Blob([result.data],{type:type});
  var bmp=await createImageBitmap(out);
  var t=document.createElement('canvas'),sc=112/Math.min(bmp.width,bmp.height);
  t.width=Math.max(1,Math.round(bmp.width*sc));t.height=Math.max(1,Math.round(bmp.height*sc));
  t.getContext('2d').drawImage(bmp,0,0,t.width,t.height);
  it.thumb=t.toDataURL('image/jpeg',.7);
  it.out=out;
  it.name=it.f.name.replace(/\.[^.]+$/,'')+'.'+format;
  it.state='Pronto · '+(result.size/1048576).toFixed(2)+' MB';it.cls='ok';
  if(bmp.close)bmp.close();
}

$('go').onclick=async function(){
  var format=heicFormat.value;
  var replace=replaceHeic.checked;
  if(replace&&!window.confirm('Substituir os arquivos HEIC/HEIF originais? Os arquivos originais serão removidos após cada conversão bem-sucedida.'))return;
  busy=true;msg.textContent='';render();
  for(var i=0;i<items.length;i++){
    var it=items[i];
    if(it.replaced)continue;
    it.out=null;it.state='Convertendo…';it.cls='';render();
    try{
      await convert(it,format);
      if(replace){
        if(!it.path)throw new Error('Não foi possível acessar o caminho do original: '+it.pathError);
        var savedPath=await window.api.replaceOriginal(it.path,format,await it.out.arrayBuffer());
        it.replaced=true;
        it.name=savedPath.split(/[\\/]/).pop();
        it.state='Original substituído por '+format.toUpperCase();
      }
    }catch(e){it.state='Erro: '+(e&&e.message?e.message:'falha ao converter');it.cls='er'}
    render();
  }
  busy=false;render();
};

async function save(it){
  var ok=await window.api.save(it.name,await it.out.arrayBuffer());
  msg.textContent=ok?'Arquivo salvo.':'';
}

$('all').onclick=async function(){
  var fs=[];
  for(var i=0;i<items.length;i++){if(items[i].out)fs.push({name:items[i].name,buf:await items[i].out.arrayBuffer()})}
  var n=await window.api.saveAll(fs);
  msg.textContent=n?n+' arquivo(s) salvo(s).':'';
};

$('clr').onclick=function(){items=[];msg.textContent='';render()};
render();
})();
