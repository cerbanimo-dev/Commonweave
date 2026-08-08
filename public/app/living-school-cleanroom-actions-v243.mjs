import {actions as legacyActions} from './cabinets/living-school/living-school-cleanroom-actions-v218.mjs';
import {state,persist,toast,progressFor,fields,clean,generateSchool} from './cabinets/living-school/living-school-cleanroom-core-v218.mjs';
import {researchCapability} from './living-school-local-research-v243.mjs?v=research-ladder-v259';

const busyLabel=(target,label)=>{target.disabled=true;target.textContent=label};
const stage=(handler,name,detail={})=>{try{handler?.(name,detail)}catch{}};
const REQUIRED_QUIZ_TYPES=['multiple-choice','multi-select','short-answer'];
const fallbackQuestion=question=>/-fallback-\d+$/i.test(clean(question?.id,160));
const genuineQuizBank=module=>(Array.isArray(module?.quiz?.bank)?module.quiz.bank:[]).filter(question=>!fallbackQuestion(question));
const quizNeeds=school=>{
  if(!school||school.generation?.fallback||clean(school.generation?.provider,80).toLowerCase()==='deterministic')return[];
  const needs=[];
  for(const module of Array.isArray(school.modules)?school.modules:[]){
    const quiz=module?.quiz&&typeof module.quiz==='object'?module.quiz:{},bank=genuineQuizBank(module);
    const count=Math.max(3,Math.min(5,Number(quiz.questionsPerAttempt||3)||3));
    const requiredCount=count+2,types=new Set(bank.map(question=>clean(question?.type,80).toLowerCase()));
    const missingTypes=REQUIRED_QUIZ_TYPES.filter(type=>!types.has(type));
    const minimumAdditional=Math.max(0,requiredCount-bank.length,missingTypes.length);
    if(minimumAdditional||missingTypes.length)needs.push({module,moduleId:clean(module?.id,160)||clean(module?.title,160),bank,count,requiredCount,missingTypes,minimumAdditional});
  }
  return needs;
};
const sharedQuizIssues=school=>quizNeeds(school).map(need=>{
  const parts=[];
  if(need.bank.length<need.requiredCount)parts.push(`${need.bank.length}/${need.requiredCount} genuine AI questions`);
  if(need.missingTypes.length)parts.push(`missing ${need.missingTypes.join(', ')}`);
  return `${need.moduleId||'module'}: ${parts.join('; ')}`;
});
const supplementalQuizSchema=()=>({
  type:'object',required:['modules'],properties:{modules:{type:'array',items:{type:'object',required:['moduleId','questions'],properties:{
    moduleId:{type:'string'},questions:{type:'array',items:{type:'object',required:['type','prompt'],properties:{
      id:{type:'string'},type:{type:'string'},prompt:{type:'string'},options:{type:'array',items:{type:'string'}},answer:{},explanation:{type:'string'},concepts:{type:'array',items:{type:'string'}},
      rubric:{type:'array',items:{type:'object',properties:{id:{type:'string'},label:{type:'string'},points:{type:'number'},role:{type:'string'},required:{type:'boolean'}}}},minWords:{type:'number'},maxWords:{type:'number'}
    }}}
  }}}}
});
function normalizeSupplementalQuestion(item,moduleId,index){
  const type=clean(item?.type,80).toLowerCase();
  if(!REQUIRED_QUIZ_TYPES.includes(type))return null;
  const prompt=clean(item?.prompt,2200);
  if(!prompt)return null;
  const options=(Array.isArray(item?.options)?item.options:[]).map(value=>clean(value,300)).filter(Boolean).slice(0,8);
  const answer=Array.isArray(item?.answer)?item.answer.map(value=>clean(value,300)).filter(Boolean):clean(item?.answer,1000);
  const rubric=(Array.isArray(item?.rubric)?item.rubric:[]).map((criterion,cIndex)=>({id:clean(criterion?.id,80)||`criterion-${cIndex+1}`,label:clean(criterion?.label,300),points:Math.max(1,Math.min(10,Number(criterion?.points||1)||1)),role:clean(criterion?.role,80)||'evidence',required:criterion?.required!==false})).filter(row=>row.label).slice(0,6);
  if((type==='multiple-choice'||type==='multi-select')&&options.length<2)return null;
  if(type==='multiple-choice'&&!clean(answer,1000))return null;
  if(type==='multi-select'&&(!Array.isArray(answer)||!answer.length))return null;
  if(type==='short-answer'&&!rubric.length)return null;
  return{
    id:clean(item?.id,120)||`${moduleId}-ai-supplement-${index+1}`,
    type,prompt,options,answer,
    explanation:clean(item?.explanation,1800),
    concepts:(Array.isArray(item?.concepts)?item.concepts:[]).map(value=>clean(value,120)).filter(Boolean).slice(0,6),
    rubric,minWords:Math.max(8,Math.min(500,Number(item?.minWords||20)||20)),maxWords:Math.max(20,Math.min(1200,Number(item?.maxWords||280)||280))
  };
}
async function completeSharedQuizBank(data,school,options={}){
  const needs=quizNeeds(school);
  if(!needs.length)return school;
  await globalThis.CivweaveFamilyAILoaderV105?.ensure?.();
  const runtime=globalThis.CivweaveModelRuntime,config=runtime?.readSharedConfig?.('interactive')||null;
  if(!runtime?.generate||!config)throw new Error('The shared AI runtime is unavailable for the targeted quiz completion pass.');
  const repairRequest=needs.map(need=>({
    moduleId:need.moduleId,title:clean(need.module?.title,220),objective:clean(need.module?.objective,1200),learningObjectives:(Array.isArray(need.module?.learningObjectives)?need.module.learningObjectives:[]).map(value=>clean(value,600)).filter(Boolean).slice(0,8),
    concepts:(Array.isArray(need.module?.concepts)?need.module.concepts:[]).map(row=>({term:clean(row?.term||row?.title,160),definition:clean(row?.definition||row?.description,800)})).filter(row=>row.term).slice(0,8),
    lessonBlocks:(Array.isArray(need.module?.lessonBlocks)?need.module.lessonBlocks:[]).slice(0,5).map(block=>({heading:clean(block?.heading,220),content:clean(block?.content,1800),sourceIds:(Array.isArray(block?.sourceIds)?block.sourceIds:[]).map(value=>clean(value,160)).filter(Boolean).slice(0,8),provenance:clean(block?.provenance,120)})),
    existingQuestions:need.bank.map(question=>({type:clean(question?.type,80),prompt:clean(question?.prompt,1200),options:(Array.isArray(question?.options)?question.options:[]).map(value=>clean(value,200)).filter(Boolean).slice(0,8),concepts:(Array.isArray(question?.concepts)?question.concepts:[]).map(value=>clean(value,120)).filter(Boolean).slice(0,6)})),
    questionsPerAttempt:need.count,minimumBankSize:need.requiredCount,minimumAdditionalQuestions:need.minimumAdditional,missingTypes:need.missingTypes
  }));
  const repairConfig={...config,maxTokens:Math.max(Number(config.maxTokens)||0,8192),temperature:Math.min(Number(config.temperature)||0.2,0.3)};
  persist('living-school-ai-quiz-delta-requested',{source:clean(options.source,120)||'living-school-workbench',schoolId:school.id,modules:repairRequest.map(row=>({moduleId:row.moduleId,minimumAdditionalQuestions:row.minimumAdditionalQuestions,missingTypes:row.missingTypes}))});
  stage(options.onStage,'repairing-quiz',{schoolId:school.id,modules:repairRequest.length,mode:'targeted-delta'});
  const result=await runtime.generate({
    purpose:'living-school-quiz-delta-completion-v258',executionProfile:'interactive',config:repairConfig,schema:supplementalQuizSchema(),
    context:{capability:data.capability,level:data.level,proofContract:data.proof,currentGeneration:{title:school.title,capability:school.capability,proof:school.proof},modules:repairRequest,constraints:['Do not rewrite any existing curriculum or quiz question.','Return only genuinely new questions for the listed module IDs.','Fill each listed missing question type first, then add enough additional questions to meet minimumBankSize.','Questions must test the actual supplied module content and capability, not generic learning-evidence boilerplate.','Do not repeat or lightly paraphrase an existing question.','Multiple-choice and multi-select questions need usable options and answers.','Short-answer questions need a visible rubric.']},
    messages:[{role:'system',content:'You are Moss performing a surgical completion pass on an already-generated Living School curriculum. Preserve the current generation exactly. Return strict JSON containing only the missing supplemental quiz questions. Do not regenerate modules, lessons, artifacts, or existing questions. Make each new question specific to the supplied module content.'},{role:'user',content:'Complete only the missing quiz-bank slots in the current generation. Keep every existing genuine AI question unchanged and return only the new questions needed to satisfy each listed module contract.'}]
  });
  if(result?.status!=='success')throw new Error(result?.error?.message||result?.error||`Targeted quiz completion ended with ${result?.status||'an error'}.`);
  const output=result.outputJson&&typeof result.outputJson==='object'?result.outputJson:{},rows=Array.isArray(output.modules)?output.modules:[];
  for(const need of needs){
    const supplement=rows.find(row=>clean(row?.moduleId,160)===need.moduleId),existingPrompts=new Set(need.bank.map(question=>clean(question?.prompt,2200).toLowerCase()));
    const incoming=(Array.isArray(supplement?.questions)?supplement.questions:[]).map((item,index)=>normalizeSupplementalQuestion(item,need.moduleId,index)).filter(Boolean).filter(question=>{
      const key=question.prompt.toLowerCase();
      if(existingPrompts.has(key))return false;
      existingPrompts.add(key);return true;
    });
    need.module.quiz={...(need.module.quiz||{}),bank:[...need.bank,...incoming].slice(0,12)};
  }
  const issues=sharedQuizIssues(school);
  if(issues.length)throw new Error(`Moss's targeted quiz completion still left the AI quiz contract incomplete, so Living School refused to persist a hybrid quiz. ${issues.join('; ')}`);
  school.generation={...(school.generation||{}),quizCompletion:'targeted-delta',quizCompletionProvider:result.actual?.provider||result.provider||config.provider||'shared',quizCompletionModel:result.actual?.model||result.model||config.model||'',quizCompletionAt:new Date().toISOString()};
  persist('living-school-ai-quiz-delta-completed',{source:clean(options.source,120)||'living-school-workbench',schoolId:school.id,moduleCount:needs.length,provider:school.generation.quizCompletionProvider,model:school.generation.quizCompletionModel});
  return school;
}
async function generateSchoolWithAtomicSharedQuiz(data,options={}){
  const school=await generateSchool(data);
  if(data.modelRoute!=='shared'||school.generation?.fallback)return school;
  return completeSharedQuizBank(data,school,options);
}

export async function generateCurriculumFromData(input={},options={}){
  const data={
    title:clean(input.title,240),
    capability:clean(input.capability,2400),
    level:clean(input.level,80)||'beginner',
    count:input.count||4,
    mode:clean(input.mode,80)||'guided',
    modelRoute:clean(input.modelRoute,120)||'shared',
    proof:clean(input.proof,3000)||'A working artifact, explanation, and independent receipt.'
  };
  if(!data.capability)throw new Error('Name an observable capability.');
  const source=clean(options.source,120)||'living-school-workbench';
  const before=state();
  before.pathContext={...(before.pathContext||{}),title:data.title||before.school?.title||before.pathContext?.title||'',capability:data.capability,proof:data.proof,source};
  persist('living-school-curriculum-requested',{source,title:data.title,capability:data.capability,level:data.level,count:Number(data.count)||4,mode:data.mode,modelRoute:data.modelRoute});

  stage(options.onStage,'researching',{capability:data.capability});
  const packet=await researchCapability(data.capability,{force:false});
  persist('living-school-research-ready',{capability:data.capability,mode:packet.mode,sourceCount:packet.sources?.length||state().research?.sourceCount||0,reused:Boolean(packet.reused),source});

  stage(options.onStage,'generating',{capability:data.capability,researchMode:packet.mode});
  const s=state(),school=await generateSchoolWithAtomicSharedQuiz(data,{source,onStage:options.onStage}),old=s.school?.modules||[],nextProgress={};
  school.modules.forEach((item,index)=>nextProgress[item.id]=s.progress[old[index]?.id]||progressFor(item.id));
  const actualModelRoute=school.generation?.fallback?'deterministic':data.modelRoute;
  s.school=school;
  s.activeModuleId=school.modules[0].id;
  s.progress=nextProgress;
  s.settings={...s.settings,modelRoute:actualModelRoute,mode:data.mode};
  s.visualInspection=null;
  persist('curriculum-generated',{schoolId:school.id,researchMode:s.research?.mode||'none',sourceCount:s.sources.length,formatContract:school.generation.formatContract,fallback:Boolean(school.generation.fallback),generationError:clean(school.generation?.error,800),requestedModelRoute:data.modelRoute,actualModelRoute,source});
  toast(school.generation.fallback?`Moss used the deterministic local compiler after shared AI failed: ${school.generation.error||'shared generation unavailable'}`:'Moss researched first and generated the formatted curriculum with shared AI.');
  stage(options.onStage,'complete',{schoolId:school.id,moduleCount:school.modules.length,requestedModelRoute:data.modelRoute,actualModelRoute,fallback:Boolean(school.generation?.fallback)});
  return school;
}

export const actions={...legacyActions,
  'research-sources':async target=>{
    const data=fields(target,['capability']);
    if(!clean(data.capability))throw new Error('Name an observable capability.');
    busyLabel(target,'Researching sources…');
    const packet=await researchCapability(data.capability,{force:true});
    persist('living-school-research-completed',{capability:data.capability,mode:packet.mode,sourceCount:packet.sources?.length||0,provider:packet.provider,model:packet.model,flag:packet.flag});
    if(packet.mode==='live-agentic')toast(`Research complete: ${packet.sources.length} live sources.`);
    else if(packet.mode==='local-synthesized')toast(`Research complete: ${packet.sources.length} downloaded local passages synthesized into a source-grounded teaching brief.`);
    else if(packet.mode==='local-downloaded')toast(`Research complete: ${packet.sources.length} clean downloaded local passages; AI synthesis was unavailable, so the raw local references will ground curriculum generation.`);
    else toast(`Research complete with ${String(packet.flag||packet.mode).toLowerCase()}.`);
  },
  'generate-curriculum':async target=>{
    const data=fields(target,['title','capability','level','count','mode','modelRoute','proof']);
    if(!clean(data.capability))throw new Error('Name an observable capability.');
    busyLabel(target,state().school?'Researching before regeneration…':'Researching before generation…');
    await generateCurriculumFromData(data,{source:'living-school-workbench',onStage:name=>{if(name==='generating')target.textContent=state().school?'Regenerating curriculum…':'Generating curriculum…';if(name==='repairing-quiz')target.textContent='Completing missing AI quiz questions…'}});
  }
};