// Alterna entre tema claro e escuro; a escolha é partilhada com a app (mesma origem).
(function(){
  var KEY='drawingbot-theme',root=document.documentElement;
  var button=document.getElementById('theme-toggle');
  if(!button)return;
  button.addEventListener('click',function(){
    var current=root.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
    var next=current==='dark'?'light':'dark';
    root.dataset.theme=next;
    try{localStorage.setItem(KEY,next);}catch(e){}
  });
})();
