// One-time polish batch following the initial rendered review.
const fs=require('node:fs');let css=fs.readFileSync('living.css','utf8').replaceAll('font-size:10px','font-size:11px');fs.writeFileSync('living.css',css);
let s=fs.readFileSync('solar.js','utf8');
s=s.replace("e.preventDefault();$('#scene-loading').hidden=false;", "e.preventDefault();setSkyPlaying(false);$('#scene-loading').hidden=false;");
const icons=`
const uiIcon=path=>'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="'+path+'"/></svg>';
const controlIcons={'zoom-in':'M12 5v14M5 12h14','zoom-out':'M5 12h14','tilt':'M4 5h16v14H4zM12 5v14','reset':'M12 2v4m0 12v4M2 12h4m12 0h4M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0','layers':'m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5','dialog-close':'m6 6 12 12M18 6 6 18','body-close':'m6 6 12 12M18 6 6 18'};
Object.entries(controlIcons).forEach(([id,path])=>$('#'+id).innerHTML=uiIcon(path));
$('#focus-booking').innerHTML='Locate '+uiIcon(controlIcons.reset);
$('#manifest').innerHTML='Manifest '+uiIcon('M4 12h15m-6-6 6 6-6 6');
$('#connect').innerHTML='Connect agent '+uiIcon('M6 18 18 6M6 6h12v12');
`;
s=s.replace('renderBookings();renderFeed();init();',icons+'renderBookings();renderFeed();init();');fs.writeFileSync('solar.js',s);
fs.copyFileSync('canvas.html','index.html');
