(() => {
  'use strict'

  const PACK_URL = 'data/question-bank.json'
  const PACK_KEY = 'powerlab.web.questionBank.v1'
  const ATTEMPT_KEY = 'powerlab.web.attempts.v1'
  const categories = [
    { id:'circuit-basics', name:'电路基础', englishName:'Circuit Fundamentals', description:'定律、等效模型与基础分析', icon:'Ω', accent:'#2563eb', tint:'#eaf0ff' },
    { id:'analog-electronics', name:'模拟电子', englishName:'Analog Electronics', description:'运放、反馈与模拟信号链', icon:'∿', accent:'#7c3aed', tint:'#f4edff' },
    { id:'digital-electronics', name:'数字电子', englishName:'Digital Electronics', description:'逻辑电路、时序与接口电平', icon:'01', accent:'#0891b2', tint:'#e8f8fb' },
    { id:'power-devices', name:'功率器件', englishName:'Power Semiconductor Devices', description:'MOSFET、IGBT、二极管与驱动', icon:'Q', accent:'#ea580c', tint:'#fff1e8' },
    { id:'power-topologies', name:'电源拓扑', englishName:'Power Converter Topologies', description:'DC-DC、AC-DC 与隔离变换', icon:'DC', accent:'#059669', tint:'#e9f8f2' },
    { id:'control-loop', name:'控制环路', englishName:'Control Loop Design', description:'环路稳定性、补偿与动态响应', icon:'φ', accent:'#0f766e', tint:'#e9f7f5' },
    { id:'pcb-emc', name:'PCB 与 EMC', englishName:'PCB & Electromagnetic Compatibility', description:'布局、回流路径、信号完整性', icon:'PCB', accent:'#be123c', tint:'#fff0f3' },
    { id:'embedded-test', name:'嵌入式与测试', englishName:'Embedded Systems & Validation', description:'接口、仪器、调试与可靠性', icon:'IO', accent:'#475569', tint:'#edf1f4' },
  ]
  const categoryMap = new Map(categories.map((item) => [item.id, item]))
  const difficultyNames = { basic:'基础', intermediate:'进阶', advanced:'高阶' }
  const sourceTypeNames = { book:'书籍', course:'课程', standard:'标准', 'application-note':'应用笔记' }

  const state = {
    pack:null,
    bundledPack:null,
    packOrigin:'网页内置',
    attempts:{},
    view:'library',
    practice:null,
    deferredInstall:null,
  }

  const $ = (selector) => document.querySelector(selector)
  const main = $('#mainContent')
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[character]))
  const safeUrl = (value) => {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '' } catch (_) { return '' }
  }
  const compareVersions = (left, right) => {
    const a = String(left).split('.').map((item) => Number(item) || 0)
    const b = String(right).split('.').map((item) => Number(item) || 0)
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (a[index] || 0) - (b[index] || 0)
      if (difference) return difference
    }
    return 0
  }

  function validatePack(value, requireBundledIds) {
    if (!value || value.schemaVersion !== 1 || typeof value.bankVersion !== 'string' || !Array.isArray(value.questions) || !Array.isArray(value.sources)) throw new Error('题库格式不正确')
    const sourceIds = new Set()
    for (const source of value.sources) {
      if (!source || !source.id || !source.title || !source.organization || !['book','course','standard','application-note'].includes(source.type) || sourceIds.has(source.id)) throw new Error('题目来源字段不完整或 ID 重复')
      sourceIds.add(source.id)
    }
    const questionIds = new Set()
    for (const question of value.questions) {
      if (!question || !question.id || questionIds.has(question.id) || !categoryMap.has(question.categoryId)) throw new Error('题目 ID 重复或分类不存在')
      questionIds.add(question.id)
      if (!['single','boolean'].includes(question.type) || !['basic','intermediate','advanced'].includes(question.difficulty)) throw new Error(`题型或难度无效：${question.id}`)
      if (!question.title || !question.explanation || !Array.isArray(question.options) || question.options.length < 2) throw new Error(`题目字段不完整：${question.id}`)
      const optionIds = new Set(question.options.map((option) => option.id))
      if (optionIds.size !== question.options.length || !optionIds.has(question.correctOptionId) || question.options.some((option) => !option.id || !option.text)) throw new Error(`选项或答案无效：${question.id}`)
      if (!Array.isArray(question.keyPoints) || !question.keyPoints.length || !Array.isArray(question.terminology) || !question.terminology.length) throw new Error(`解析字段不完整：${question.id}`)
      if ((question.sourceIds || []).some((id) => !sourceIds.has(id))) throw new Error(`题目引用了不存在的来源：${question.id}`)
    }
    if (value.questions.length < 48) throw new Error('题库题目数少于内置版本')
    if (requireBundledIds && state.bundledPack) {
      const missing = state.bundledPack.questions.find((question) => !questionIds.has(question.id))
      if (missing) throw new Error(`题库缺少内置题目：${missing.id}`)
    }
    return value
  }

  async function fetchOnlinePack(force) {
    const response = await fetch(`${PACK_URL}?t=${force ? Date.now() : 'startup'}`, { cache:force ? 'reload' : 'no-cache' })
    if (!response.ok) throw new Error(`题库请求失败：${response.status}`)
    return validatePack(await response.json(), false)
  }

  function loadStoredPack() {
    try {
      const stored = JSON.parse(localStorage.getItem(PACK_KEY) || 'null')
      if (!stored || !stored.pack) return null
      validatePack(stored.pack, false)
      return stored
    } catch (_) { return null }
  }

  function saveActivePack(pack, origin) {
    localStorage.setItem(PACK_KEY, JSON.stringify({ pack, origin, savedAt:Date.now() }))
    state.pack = pack
    state.packOrigin = origin
  }

  function loadAttempts() {
    try { state.attempts = JSON.parse(localStorage.getItem(ATTEMPT_KEY) || '{}') || {} } catch (_) { state.attempts = {} }
  }
  function saveAttempts() { localStorage.setItem(ATTEMPT_KEY, JSON.stringify(state.attempts)) }
  function categoryQuestions(categoryId) { return state.pack.questions.filter((question) => question.categoryId === categoryId) }
  function categoryProgress(categoryId) {
    const questions = categoryQuestions(categoryId)
    const records = questions.map((question) => state.attempts[question.id]).filter(Boolean)
    const correct = records.filter((record) => record.isCorrect).length
    return { total:questions.length, answered:records.length, correct, mistakes:records.length - correct, accuracy:records.length ? Math.round(correct / records.length * 100) : 0 }
  }
  function allProgress() {
    const records = state.pack.questions.map((question) => state.attempts[question.id]).filter(Boolean)
    const correct = records.filter((record) => record.isCorrect).length
    return { total:state.pack.questions.length, answered:records.length, correct, mistakes:records.length - correct, accuracy:records.length ? Math.round(correct / records.length * 100) : 0, completion:state.pack.questions.length ? Math.round(records.length / state.pack.questions.length * 100) : 0 }
  }

  function showToast(message) {
    const toast = $('#toast')
    toast.textContent = message
    toast.classList.add('show')
    clearTimeout(showToast.timer)
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600)
  }

  function setView(view) {
    state.view = view
    state.practice = null
    document.querySelectorAll('.bottom-nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === view))
    render()
    window.scrollTo({ top:0, behavior:'smooth' })
  }

  function render() {
    if (state.practice) renderPractice()
    else if (state.view === 'mistakes') renderMistakes()
    else if (state.view === 'progress') renderProgress()
    else renderLibrary()
    updateManagerSummary()
  }

  function renderLibrary() {
    const total = allProgress()
    const cards = categories.map((category) => {
      const progress = categoryProgress(category.id)
      const percent = progress.total ? Math.round(progress.answered / progress.total * 100) : 0
      return `<button class="category-card" data-category="${escapeHtml(category.id)}" type="button">
        <span class="category-icon" style="color:${category.accent};background:${category.tint}">${escapeHtml(category.icon)}</span>
        <span class="category-body"><span class="category-title"><strong>${escapeHtml(category.name)}</strong><span>${progress.total} 题</span></span>
        <span class="category-en">${escapeHtml(category.englishName)}</span><span class="category-desc">${escapeHtml(category.description)}</span>
        <span class="track"><span style="width:${percent}%;background:${category.accent}"></span></span><span class="track-label"><span>已完成 ${progress.answered} / ${progress.total}</span><span>${progress.answered ? `正确率 ${progress.accuracy}%` : '开始练习'}</span></span></span>
      </button>`
    }).join('')
    main.innerHTML = `<section class="hero"><div class="hero-kicker">POWER &amp; HARDWARE INTERVIEW LAB · V${escapeHtml(state.pack.bankVersion)}</div>
      <h1>把硬件知识练成工程判断力</h1><p class="hero-copy">覆盖电路、电源、控制、PCB 与调试。每道题都有工程化解析、专业术语和参考来源。</p>
      <div class="hero-meta"><span class="pill">${escapeHtml(state.packOrigin)} · 离线可用</span><span class="pill">${state.pack.sources.length} 个参考来源</span></div>
      <button id="startRandom" class="primary-action random-action" type="button">随机练习 · ${Math.min(20, total.total)} 题</button>
      <div class="hero-stats"><div class="hero-stat"><strong>${categories.length}</strong><span>知识分类</span></div><div class="hero-stat"><strong>${total.total}</strong><span>专业题目</span></div><div class="hero-stat"><strong>${total.answered}</strong><span>已完成</span></div></div></section>
      <div class="section-head"><div><h2>选择一个方向</h2><p>从基础原理到工程实践</p></div><span class="summary">完成度 ${total.completion}%</span></div>
      <section class="category-grid">${cards}</section><aside class="notice"><strong>工程安全提示：</strong>涉及市电、高压和功率实验时，请遵守实验室安全规范。题库不能替代数据手册与安全评审。</aside>`
  }

  function renderMistakes() {
    const questions = state.pack.questions.filter((question) => state.attempts[question.id] && !state.attempts[question.id].isCorrect)
    if (!questions.length) {
      main.innerHTML = `<div class="section-head"><div><h2>错题本</h2><p>最近一次回答错误的题目</p></div></div><section class="empty"><div class="empty-mark">✓</div><h2>还没有错题</h2><p>开始分类练习后，答错的题目会自动出现在这里。</p></section>`
      return
    }
    main.innerHTML = `<div class="section-head"><div><h2>错题本</h2><p>点击题目重新练习</p></div><span class="summary">${questions.length} 道待复习</span></div><section class="mistake-list">${questions.map((question) => { const category=categoryMap.get(question.categoryId); return `<button class="mistake-card" data-question="${escapeHtml(question.id)}" type="button"><small>${escapeHtml(category.name)} · ${escapeHtml(difficultyNames[question.difficulty])}</small><strong>${escapeHtml(question.title)}</strong><span>上次选择：${escapeHtml(state.attempts[question.id].selectedOptionId)} · 点击重做</span></button>` }).join('')}</section>`
  }

  function renderProgress() {
    const total = allProgress()
    main.innerHTML = `<section class="progress-overview"><small>OVERALL PROGRESS</small><div class="progress-number">${total.completion}<span>%</span></div><p>已完成 ${total.answered} / ${total.total} 道题</p><div class="track"><span style="width:${total.completion}%;background:#49d2ff"></span></div></section>
      <section class="metric-grid"><div class="metric-card"><strong>${total.correct}</strong><span>当前答对</span></div><div class="metric-card"><strong>${total.mistakes}</strong><span>当前错题</span></div><div class="metric-card"><strong>${total.accuracy}%</strong><span>正确率</span></div></section>
      <div class="section-head"><div><h2>分类掌握情况</h2><p>根据最近一次答题结果统计</p></div></div>
      <section class="progress-list">${categories.map((category) => { const p=categoryProgress(category.id); const percent=p.total?Math.round(p.answered/p.total*100):0; return `<article class="progress-card"><div class="progress-card-head"><strong>${escapeHtml(category.name)}</strong><span>${p.answered} / ${p.total}</span></div><div class="track"><span style="width:${percent}%;background:${category.accent}"></span></div><div class="progress-card-foot"><span>完成 ${percent}%</span><span>正确率 ${p.accuracy}%</span></div></article>` }).join('')}</section>
      <button id="resetProgressButton" class="reset-progress" type="button">重置全部学习记录</button>`
  }

  function startCategory(categoryId) {
    const questions = categoryQuestions(categoryId)
    if (!questions.length) return showToast('该分类暂无题目')
    state.practice = { questions, index:0, selected:'', submitted:false, returnView:state.view }
    renderPractice()
    window.scrollTo(0,0)
  }

  function startRandom() {
    const questions = state.pack.questions.slice()
    const count = Math.min(20, questions.length)
    for (let index = 0; index < count; index += 1) {
      const pick = index + Math.floor(Math.random() * (questions.length - index))
      const previous = questions[index]
      questions[index] = questions[pick]
      questions[pick] = previous
    }
    if (!count) return showToast('题库暂无题目')
    state.practice = { questions:questions.slice(0, count), index:0, selected:'', submitted:false, returnView:state.view }
    renderPractice()
    window.scrollTo(0,0)
  }

  function startQuestion(questionId) {
    const question = state.pack.questions.find((item) => item.id === questionId)
    if (!question) return
    state.practice = { questions:[question], index:0, selected:'', submitted:false, returnView:state.view }
    renderPractice()
    window.scrollTo(0,0)
  }

  function renderPractice() {
    const session = state.practice
    const question = session.questions[session.index]
    const category = categoryMap.get(question.categoryId)
    const sourceMap = new Map(state.pack.sources.map((source) => [source.id, source]))
    const answerCorrect = session.submitted && session.selected === question.correctOptionId
    const options = question.options.map((option, index) => {
      const classes = ['option']
      if (session.selected === option.id) classes.push('selected')
      if (session.submitted && option.id === question.correctOptionId) classes.push('correct')
      if (session.submitted && session.selected === option.id && option.id !== question.correctOptionId) classes.push('wrong')
      return `<button class="${classes.join(' ')}" data-option="${escapeHtml(option.id)}" type="button" ${session.submitted?'disabled':''}><span class="option-letter">${String.fromCharCode(65+index)}</span><span>${escapeHtml(option.text)}</span></button>`
    }).join('')
    const terms = question.terminology.map((term) => `<article class="term"><strong>${escapeHtml(term.englishName)} · ${escapeHtml(term.chineseName)}${term.abbreviation ? ` · ${escapeHtml(term.abbreviation)}` : ''}</strong><p>${escapeHtml(term.role)}</p></article>`).join('')
    const sources = (question.sourceIds || []).map((id) => sourceMap.get(id)).filter(Boolean).map((source) => { const url=safeUrl(source.url); return `<div class="source">[${escapeHtml(sourceTypeNames[source.type] || source.type)}] ${escapeHtml(source.organization)}：${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(source.title)}</a>` : escapeHtml(source.title)}</div>` }).join('')
    const analysis = session.submitted ? `<section class="analysis"><div class="result-banner ${answerCorrect?'':'wrong'}">${answerCorrect?'回答正确':'回答错误'} · 正确答案 ${escapeHtml(question.correctOptionId)}</div><h3>详细解析</h3><p>${escapeHtml(question.explanation)}</p><h3>核心要点</h3><ul>${question.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul><h3>专业术语</h3><div class="term-list">${terms}</div>${sources?`<h3>参考来源</h3><div class="source-list">${sources}</div>`:''}</section>` : ''
    const isLast = session.index === session.questions.length - 1
    main.innerHTML = `<section class="practice-shell"><div class="practice-top"><button id="leavePractice" class="back-button" type="button">←</button><div class="practice-heading"><strong>${escapeHtml(category.name)}</strong><span>${escapeHtml(category.englishName)}</span></div><div class="practice-progress">${session.index+1} / ${session.questions.length}</div></div>
      <article class="question-card"><div class="question-meta"><span>${escapeHtml(difficultyNames[question.difficulty])}</span><span>${question.type==='boolean'?'判断题':'单选题'}</span></div><h2>${escapeHtml(question.title)}</h2><div class="options">${options}</div>${analysis}<button id="questionAction" class="primary-action" type="button" ${!session.submitted&&!session.selected?'disabled':''}>${session.submitted?(isLast?'完成本组':'下一题'):'提交答案'}</button></article></section>`
  }

  function submitOrNext() {
    const session = state.practice
    const question = session.questions[session.index]
    if (!session.submitted) {
      if (!session.selected) return
      session.submitted = true
      state.attempts[question.id] = { questionId:question.id, categoryId:question.categoryId, selectedOptionId:session.selected, isCorrect:session.selected === question.correctOptionId, answeredAt:Date.now() }
      saveAttempts()
      renderPractice()
      return
    }
    if (session.index < session.questions.length - 1) {
      session.index += 1
      session.selected = ''
      session.submitted = false
      renderPractice()
      window.scrollTo({top:0,behavior:'smooth'})
    } else {
      const target = session.returnView
      state.practice = null
      setView(target)
      showToast('本组练习已完成')
    }
  }

  function updateManagerSummary() {
    if (!state.pack) return
    $('#managerVersion').textContent = `V${state.pack.bankVersion}`
    $('#managerStatus').textContent = `${state.packOrigin} · ${state.pack.questions.length} 题 · 离线可用`
  }
  function managerMessage(message, isError) {
    const element = $('#managerMessage')
    element.textContent = message
    element.classList.toggle('error', Boolean(isError))
  }

  async function checkForUpdate() {
    managerMessage('正在检查最新题库…', false)
    try {
      const online = await fetchOnlinePack(true)
      state.bundledPack = online
      if (compareVersions(online.bankVersion, state.pack.bankVersion) > 0) {
        saveActivePack(online, '联网更新')
        managerMessage(`已更新至 V${online.bankVersion}，共 ${online.questions.length} 道题。`, false)
        render()
      } else managerMessage(`当前已是最新版本 V${state.pack.bankVersion}。`, false)
    } catch (error) { managerMessage(`检查失败：${error.message}`, true) }
  }

  async function importFile(file) {
    managerMessage('正在校验题库文件…', false)
    try {
      const pack = validatePack(JSON.parse(await file.text()), true)
      if (compareVersions(pack.bankVersion, state.pack.bankVersion) < 0) throw new Error(`导入版本 ${pack.bankVersion} 低于当前版本 ${state.pack.bankVersion}`)
      saveActivePack(pack, '本地导入')
      managerMessage(`导入成功：V${pack.bankVersion}，共 ${pack.questions.length} 道题。`, false)
      render()
    } catch (error) { managerMessage(`导入失败：${error.message}`, true) }
    $('#fileInput').value = ''
  }

  function bindEvents() {
    document.querySelector('.bottom-nav').addEventListener('click', (event) => { const button=event.target.closest('button[data-view]'); if(button) setView(button.dataset.view) })
    main.addEventListener('click', (event) => {
      if (event.target.closest('#startRandom')) return startRandom()
      const category = event.target.closest('[data-category]'); if(category) return startCategory(category.dataset.category)
      const mistake = event.target.closest('[data-question]'); if(mistake) return startQuestion(mistake.dataset.question)
      const option = event.target.closest('[data-option]'); if(option && state.practice && !state.practice.submitted) { state.practice.selected=option.dataset.option; return renderPractice() }
      if (event.target.closest('#questionAction')) return submitOrNext()
      if (event.target.closest('#leavePractice')) { const target=state.practice.returnView; state.practice=null; return setView(target) }
      if (event.target.closest('#resetProgressButton') && confirm('确定清空全部学习记录吗？')) { state.attempts={}; saveAttempts(); render(); showToast('学习记录已重置') }
    })
    $('#manageButton').addEventListener('click', () => { managerMessage('',false); updateManagerSummary(); $('#managerDialog').showModal() })
    $('#fileInput').addEventListener('change', (event) => { const file=event.target.files[0]; if(file) importFile(file) })
    $('#checkUpdateButton').addEventListener('click', checkForUpdate)
    $('#restoreButton').addEventListener('click', () => { if (!confirm('确定恢复网页内置题库吗？')) return; localStorage.removeItem(PACK_KEY); state.pack=state.bundledPack; state.packOrigin='网页内置'; managerMessage('已恢复网页内置题库。',false); render() })
    window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.deferredInstall=event; $('#installButton').hidden=false })
    $('#installButton').addEventListener('click', async () => {
      if (state.deferredInstall) { state.deferredInstall.prompt(); await state.deferredInstall.userChoice; state.deferredInstall=null; $('#installButton').hidden=true }
      else showToast('请用 Safari 打开，点击“分享”→“添加到主屏幕”')
    })
    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone
    if (isiOS && !standalone) $('#installButton').hidden=false
  }

  async function boot() {
    loadAttempts()
    const stored = loadStoredPack()
    try {
      const online = await fetchOnlinePack(false)
      state.bundledPack = online
      if (stored && compareVersions(stored.pack.bankVersion, online.bankVersion) >= 0) { state.pack=stored.pack; state.packOrigin=stored.origin || '本地题库' }
      else { state.pack=online; state.packOrigin='网页内置'; saveActivePack(online,state.packOrigin) }
    } catch (error) {
      if (!stored) { $('#loading').innerHTML=`<div class="loading-mark">!</div><strong>题库加载失败</strong><span>${escapeHtml(error.message)}，请联网后重试。</span>`; return }
      state.pack=stored.pack; state.bundledPack=stored.pack; state.packOrigin=`${stored.origin || '本地缓存'} · 离线`
    }
    bindEvents()
    $('#loading').hidden=true
    $('#app').hidden=false
    render()
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
  }

  boot()
})()
