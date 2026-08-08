import{copy,state,VERSION,clean}from'./living-school-cleanroom-core-v218.mjs';
import{render}from'./living-school-cleanroom-render-v218.mjs';
import{actions,generateCurriculumFromData}from'../../living-school-cleanroom-actions-v243.mjs?v=research-ladder-v259';

let busy=false,dispatchCount=0;
const LEVELS=new Set(['beginner','intermediate','advanced']);
const MODES=new Set(['guided','just-in-time','browse']);

function markDispatch(){
  dispatchCount+=1;
  document.documentElement.dataset.livingSchoolDispatchCount=String(dispatchCount);
}

async function handleLivingSchoolClick(event){
  const target=event.target?.closest?.('[data-ls-action]');
  if(!target)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(target.disabled||busy)return;
  const action=actions[String(target.dataset.lsAction||'').trim()];
  if(!action)return;
  busy=true;markDispatch();
  try{await action(target)}catch(error){console.error('[Living School cleanroom]',error);const toast=document.getElementById('lsc218-toast');if(toast){toast.textContent=String(error?.message||error);toast.hidden=false}}
  finally{busy=false;render()}
}

function chatCurriculumData(input={}){
  const s=state(),rawLevel=clean(input.level,80).toLowerCase(),rawMode=clean(input.mode,80).toLowerCase();
  return{
    title:clean(input.title,240)||clean(s.school?.title||s.pathContext?.title,240),
    capability:clean(input.capability,2400)||clean(s.school?.capability||s.pathContext?.capability,2400),
    level:LEVELS.has(rawLevel)?rawLevel:LEVELS.has(clean(s.school?.level,80).toLowerCase())?clean(s.school.level,80).toLowerCase():'beginner',
    count:Math.max(1,Math.min(8,Number(input.count||s.school?.modules?.length||4)||4)),
    mode:MODES.has(rawMode)?rawMode:MODES.has(clean(s.settings?.mode,80).toLowerCase())?clean(s.settings.mode,80).toLowerCase():'guided',
    modelRoute:clean(input.modelRoute,120)||clean(s.settings?.modelRoute,120)||'shared',
    proof:clean(input.proof,3000)||clean(s.school?.proof||s.pathContext?.proof,3000)||'A working artifact, explanation, and independent receipt.'
  };
}

async function generateCurriculumFromChat(input={}){
  if(busy)throw new Error('Living School is already processing another learning action.');
  const data=chatCurriculumData(input);
  if(!data.capability)throw new Error('Moss needs an observable capability before generating the curriculum.');
  busy=true;markDispatch();
  document.documentElement.dataset.livingSchoolChatAction='generating-curriculum';
  try{
    const school=await generateCurriculumFromData(data,{source:'moss-shared-chat',onStage:(stage,detail)=>{
      document.documentElement.dataset.livingSchoolChatStage=stage;
      try{dispatchEvent(new CustomEvent('civweave:living-school-curriculum-stage',{detail:{stage,...detail,title:data.title,capability:data.capability}}))}catch{}
    }});
    render();
    const result={school:copy(school),sourceCount:Number(state().sources?.length||0),research:copy(state().research||null),activeModuleId:state().activeModuleId};
    try{dispatchEvent(new CustomEvent('civweave:living-school-curriculum-generated',{detail:{schoolId:school.id,title:school.title,moduleCount:school.modules.length,capability:school.capability,source:'moss-shared-chat'}}))}catch{}
    return result;
  }finally{
    busy=false;
    document.documentElement.dataset.livingSchoolChatAction='idle';
    render();
  }
}

document.addEventListener('click',handleLivingSchoolClick,true);
render();
globalThis.LivingSchoolCleanroomV218=Object.freeze({version:VERSION,controller:'single-delegated-click-handler',researchAdapter:'live-local-synthesis-v259',getState:()=>copy(state()),render,dispatchCount:()=>dispatchCount,generateCurriculumFromChat,normalizeChatCurriculum:chatCurriculumData,legacyNavigation:false});
try{dispatchEvent(new CustomEvent('civweave:living-school-workbench-ready',{detail:{version:VERSION,chatCurriculumBridge:true}}))}catch{}