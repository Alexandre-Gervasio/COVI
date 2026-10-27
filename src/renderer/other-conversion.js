(function(){
var $=function(i){return document.getElementById(i)};
var generalItems=[],generalBusy=false,generalExtensions=[],generalFormatsLoaded=false;
var generalDrop=$('general-drop'),generalFile=$('general-file');
var generalList=$('general-list'),generalFormat=$('general-fmt'),generalMsg=$('general-msg');
var replaceGeneral=$('replace-general'),outputFormats=[];
var tabHeic=$('tab-heic'),tabGeneral=$('tab-general');

function selectTab(name){
  var isHeic=name==='heic';
  $('heic-panel').hidden=!isHeic;
  $('general-panel').hidden=isHeic;
  tabHeic.setAttribute('aria-selected',String(isHeic));
  tabGeneral.setAttribute('aria-selected',String(!isHeic));
}
tabHeic.onclick=function(){selectTab('heic')};
tabGeneral.onclick=function(){selectTab('general')};

function updateGeneralFormats(){
  var analyzing=generalItems.some(function(item){return item.state==='Analisando imagem…'});
  var pending=generalItems.filter(function(item){return !item.replaced});
  var compatible=outputFormats.filter(function(format){
    return pending.length&&pending.every(function(item){
      return item.info&&item.info.targets.some(function(target){return target.id===format.id});
    });
  }).map(function(format){return format.id});
  var previous=generalFormat.value;
  generalFormat.innerHTML='';
  compatible.forEach(function(format){
    var option=document.createElement('option');
    option.value=format;
    option.textContent=outputFormats.find(function(candidate){return candidate.id===format}).label;
    generalFormat.appendChild(option);
  });
  if(compatible.indexOf(previous)!==-1)generalFormat.value=previous;
  else if(compatible.indexOf('png')!==-1)generalFormat.value='png';
  $('general-go').disabled=!pending.length||!compatible.length||generalBusy||analyzing;
}

function renderGeneral(){
  generalList.innerHTML='';
  generalItems.forEach(function(item){
    var li=document.createElement('li');
    var details=document.createElement('div');details.className='in';
    var name=document.createElement('div');name.className='nm';name.textContent=item.replaced?item.name:item.file.name;
    var state=document.createElement('div');state.className='st '+item.cls;state.textContent=item.state;
    details.appendChild(name);details.appendChild(state);li.appendChild(details);
    if(item.output&&!item.replaced){
      var saveButton=document.createElement('button');saveButton.textContent='Salvar';
      saveButton.onclick=function(){saveGeneral(item)};
      li.appendChild(saveButton);
    }
    generalList.appendChild(li);
  });
  updateGeneralFormats();
  var done=generalItems.some(function(item){return item.output&&!item.replaced});
  $('general-all').disabled=!done||generalBusy;
  $('general-clear').disabled=!generalItems.length||generalBusy;
  replaceGeneral.disabled=generalBusy;
  generalFormat.disabled=generalBusy;
}

function addGeneral(files){
  if(generalBusy){generalMsg.textContent='Aguarde a conversão atual terminar antes de adicionar arquivos.';return}
  if(!generalFormatsLoaded){generalMsg.textContent='Aguarde a lista de formatos compatíveis carregar.';return}
  generalMsg.textContent='';
  Array.prototype.forEach.call(files,function(file){
    var extension=(file.name.match(/\.([^.]+)$/)||[])[1];
    if(!extension||generalExtensions.indexOf(extension.toLowerCase())===-1){
      generalMsg.textContent='Um ou mais arquivos foram ignorados: formato não suportado nesta instalação.';
      return;
    }
    var filePath;
    try{filePath=window.api.getPathForFile(file)}
    catch(error){generalMsg.textContent='Não foi possível acessar o arquivo: '+error.message;return}
    var item={file:file,path:filePath,info:null,output:null,name:'',state:'Analisando imagem…',cls:''};
    generalItems.push(item);
    window.api.getImageConversionInfo(item.path).then(function(info){
      item.info=info;
      item.state=info.targets.length
        ?info.width+' × '+info.height+' · '+info.depth
        :info.reason;
      item.cls=info.targets.length?'':'er';
    }).catch(function(error){
      item.state='Não foi possível ler: '+error.message;
      item.cls='er';
    }).finally(renderGeneral);
  });
  renderGeneral();
}

generalDrop.onclick=function(){generalFile.click()};
generalDrop.onkeydown=function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();generalFile.click()}};
['dragover','dragenter'].forEach(function(name){
  generalDrop.addEventListener(name,function(event){event.preventDefault();generalDrop.classList.add('on')});
});
['dragleave','drop'].forEach(function(name){
  generalDrop.addEventListener(name,function(event){event.preventDefault();generalDrop.classList.remove('on')});
});
generalDrop.addEventListener('drop',function(event){addGeneral(event.dataTransfer.files)});
generalFile.onchange=function(){addGeneral(generalFile.files);generalFile.value=''};

$('general-go').onclick=async function(){
  var format=generalFormat.value;
  var replace=replaceGeneral.checked;
  if(replace&&!window.confirm('Substituir os arquivos originais? Os originais serão removidos somente após cada conversão bem-sucedida.'))return;
  generalBusy=true;generalMsg.textContent='';renderGeneral();
  for(var i=0;i<generalItems.length;i++){
    var item=generalItems[i];
    if(item.replaced)continue;
    if(!item.info||!item.info.targets.some(function(target){return target.id===format}))continue;
    item.output=null;item.replaced=false;item.state='Convertendo…';item.cls='';renderGeneral();
    try{
      var result=await window.api.convertImage(item.path,format);
      item.output=result.data;
      var outputFormat=outputFormats.find(function(candidate){return candidate.id===format});
      item.name=item.file.name.replace(/\.[^.]+$/,'')+'.'+outputFormat.extension;
      if(replace){
        var savedPath=await window.api.replaceOriginal(item.path,outputFormat.extension,item.output);
        item.replaced=true;
        item.name=savedPath.split(/[\\/]/).pop();
        item.state='Original substituído · '+outputFormat.label;
      }else{
        item.state='Pronto · '+(result.size/1048576).toFixed(2)+' MB · '+outputFormat.label;
      }
      item.cls='ok';
    }catch(error){item.state='Erro: '+error.message;item.cls='er'}
    renderGeneral();
  }
  generalBusy=false;renderGeneral();
};

async function saveGeneral(item){
  try{
    var ok=await window.api.save(item.name,item.output.buffer.slice(
      item.output.byteOffset,item.output.byteOffset+item.output.byteLength
    ));
    generalMsg.textContent=ok?'Arquivo salvo.':'';
  }catch(error){generalMsg.textContent='Não foi possível salvar: '+error.message}
}

$('general-all').onclick=async function(){
  try{
    var files=[];
    for(var i=0;i<generalItems.length;i++){
      var item=generalItems[i];
      if(item.output&&!item.replaced)files.push({name:item.name,buf:item.output.buffer.slice(
        item.output.byteOffset,item.output.byteOffset+item.output.byteLength
      )});
    }
    var count=await window.api.saveAll(files);
    generalMsg.textContent=count?count+' arquivo(s) salvo(s).':'';
  }catch(error){
    generalMsg.textContent='Não foi possível salvar os arquivos: '+error.message;
  }
};

$('general-clear').onclick=function(){generalItems=[];generalMsg.textContent='';renderGeneral()};
window.api.getImageConverterFormats().then(function(formats){
  generalFormatsLoaded=true;
  generalExtensions=formats.extensions;
  generalFile.accept=generalExtensions.map(function(extension){return '.'+extension}).join(',');
  $('general-formats').textContent='Entradas compatíveis: '+generalExtensions.map(function(extension){return '.'+extension}).join(', ');
  generalFormat.innerHTML='';
  outputFormats=formats.outputs;
  outputFormats.forEach(function(format){
    var option=document.createElement('option');
    option.value=format.id;option.textContent=format.label;generalFormat.appendChild(option);
  });
}).catch(function(error){
  generalFormatsLoaded=true;
  $('general-formats').textContent='Não foi possível carregar os formatos: '+error.message;
});
})();
