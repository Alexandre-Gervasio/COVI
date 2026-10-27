(function(){
var $=function(i){return document.getElementById(i)};
var versionBadge=$('app-version');
var updateButton=$('update-action');
var updateMessage=$('update-status');

window.api.getVersion().then(function(version){
  versionBadge.textContent='v'+version;
}).catch(function(error){
  versionBadge.textContent='Versão indisponível';
  console.error('Não foi possível carregar a versão do C.O.V.I.',error);
});

function renderUpdateStatus(status){
  if(!status)return;
  updateMessage.textContent=status.message||'';
  if(status.state==='checking'){
    updateButton.textContent='Verificando…';
    updateButton.disabled=true;
  }else if(status.state==='downloading'){
    updateButton.textContent='Baixando atualização…';
    updateButton.disabled=true;
  }else if(status.state==='downloaded'){
    updateButton.textContent='Reiniciar e atualizar';
    updateButton.disabled=false;
  }else if(status.state==='available'){
    updateButton.textContent=status.version?'Baixar versão '+status.version:'Baixar atualização';
    updateButton.disabled=false;
  }else if(status.state==='error'){
    updateButton.textContent='Tentar novamente';
    updateButton.disabled=false;
  }else if(status.state==='current'){
    updateButton.textContent='Verificar novamente';
    updateButton.disabled=false;
  }else{
    updateButton.textContent='Verificar atualizações';
    updateButton.disabled=false;
  }
}

window.api.onUpdateStatus(renderUpdateStatus);
window.api.getUpdateStatus().then(renderUpdateStatus).catch(function(error){
  updateMessage.textContent='Não foi possível consultar o estado da atualização: '+error.message;
  console.error('Não foi possível consultar o estado da atualização.',error);
});
updateButton.onclick=async function(){
  updateButton.disabled=true;
  updateMessage.textContent='Solicitando verificação de atualizações…';
  try{
    renderUpdateStatus(await window.api.updateAction());
  }catch(error){
    renderUpdateStatus({state:'error',message:'Falha ao iniciar atualização: '+error.message});
    console.error('Não foi possível iniciar a atualização.',error);
  }
};
})();
