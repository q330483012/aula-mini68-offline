'use strict';
document.addEventListener('DOMContentLoaded', () => {
  const { invoke } = window.__TAURI__.core;
  const keys = window.Mini68Keys;
  const open = document.createElement('button');
  open.id = 'mini68-local-open'; open.textContent = '本地增强';
  const panel = document.createElement('dialog');
  panel.id = 'mini68-local-panel'; panel.setAttribute('aria-labelledby', 'local-title');
  // All variable content below is assigned through textContent, never HTML.
  panel.innerHTML = `
    <header><h2 id="local-title">本地增强</h2><button id="local-close" type="button">关闭</button></header>
    <p class="local-muted">组合键映射与启动设置保存在这台电脑上。</p>
    <section aria-labelledby="local-startup-title">
      <h3 id="local-startup-title">后台运行</h3>
      <label class="local-toggle"><input id="local-startup" type="checkbox">开机自启动</label>
      <p class="local-muted">登录 Windows 后启动并收至托盘，恢复已启用的组合键映射。此开关立即生效。</p>
      <p class="local-muted">音乐律动仍需连接键盘并进入音乐律动页面；关闭窗口后可继续运行。</p>
    </section>
    <section aria-labelledby="local-mapping-title">
      <h3 id="local-mapping-title">组合键映射</h3>
      <label class="local-toggle"><input id="local-enabled" type="checkbox">启用组合键映射</label>
      <p class="local-muted">作用于本机所有键盘，每次按下触发一次。程序须留在后台；托盘菜单可随时暂停或恢复。</p>
      <div class="local-editor">
        <fieldset><legend>来源组合键</legend><div class="local-modifiers" id="local-modifiers"></div>
          <label class="local-key-label">来源按键<select id="local-source" aria-label="来源按键"></select></label>
        </fieldset>
        <label class="local-key-label">映射为<select id="local-target" aria-label="目标按键"></select></label>
        <button id="local-add" type="button">添加规则</button>
      </div>
      <p id="local-empty" class="local-muted">尚无映射规则。可先添加 Ctrl + J → Home，再启用并保存。</p>
      <table class="local-table" aria-label="组合键映射列表"><thead><tr><th>映射</th><th>运行状态</th><th>操作</th></tr></thead><tbody id="local-rules"></tbody></table>
      <details><summary>测试映射</summary>
        <p class="local-muted">保存后，在下面的文字中移动光标并按组合键。例如 Home 应移动到当前行开头。管理员窗口需要同等权限；部分游戏的原始输入可能不支持。</p>
        <textarea aria-label="映射测试输入框" spellcheck="false">第一行：测试文字\n第二行：把光标放在行中间，再按组合键</textarea>
      </details>
    </section>
    <p id="local-message" role="status" aria-live="polite"></p>
    <footer><span class="local-muted">映射修改后请保存并应用</span><button id="local-save" class="local-primary" type="button">保存并应用</button></footer>`;
  document.body.append(open, panel);
  const find = id => panel.querySelector('#local-' + id);
  let rules = [], errors = [], savedEnabled = false, dirty = false;
  for (const [bit, name] of keys.modifiers) {
    const label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.value = bit; input.checked = bit === 2;
    label.append(input, name); find('modifiers').append(label);
  }
  for (const name of ['source', 'target']) for (const [code, text] of keys.keys) {
    const option = document.createElement('option'); option.value = code; option.textContent = text;
    find(name).append(option);
  }
  find('source').value = 74; find('target').value = 36;
  function message(text, error = false) {
    find('message').textContent = String(text); find('message').classList.toggle('local-error', error);
  }
  function render() {
    find('rules').replaceChildren(); find('empty').hidden = rules.length > 0;
    rules.forEach((rule, index) => {
      const row = document.createElement('tr'), chord = document.createElement('td');
      const state = document.createElement('td'), action = document.createElement('td'), remove = document.createElement('button');
      chord.textContent = keys.label(rule);
      state.textContent = dirty ? '待应用' : errors[index] || (savedEnabled ? '已启用' : '未启用');
      state.classList.toggle('local-error', !!errors[index]);
      remove.type = 'button'; remove.textContent = '删除'; remove.setAttribute('aria-label', '删除 ' + keys.label(rule));
      remove.onclick = () => { rules.splice(index, 1); errors = []; dirty = true; render(); message('修改尚未应用，请保存。'); };
      action.append(remove); row.append(chord, state, action); find('rules').append(row);
    });
  }
  function load(snapshot) {
    rules = snapshot.config.rules.map(r => ({ ...r })); errors = snapshot.errors;
    savedEnabled = snapshot.config.enabled; dirty = false;
    find('enabled').checked = snapshot.config.enabled; find('startup').checked = snapshot.startup;
    render(); message(snapshot.warning || '');
  }
  async function busy(button, action) {
    button.disabled = true;
    try { await action(); } catch (error) { message(error, true); }
    finally { button.disabled = false; }
  }
  open.onclick = () => busy(open, async () => {
    load(await invoke('desktop_get')); panel.showModal(); find('close').focus();
  });
  find('close').onclick = () => panel.close();
  panel.addEventListener('close', () => open.focus());
  find('startup').onchange = () => busy(find('startup'), async () => {
    const enabled = find('startup').checked;
    try {
      const snapshot = await invoke('desktop_startup', { enabled });
      find('startup').checked = snapshot.startup; message(enabled ? '已启用开机自启动。' : '已关闭开机自启动。');
    } catch (error) { find('startup').checked = !enabled; throw error; }
  });
  find('enabled').onchange = () => { dirty = true; render(); message('修改尚未应用，请保存。'); };
  find('add').onclick = () => {
    const rule = { modifiers: [...find('modifiers').querySelectorAll('input:checked')].reduce((sum, input) => sum | Number(input.value), 0),
      key: Number(find('source').value), target: Number(find('target').value) };
    const error = keys.validate([...rules, rule]);
    if (error) return message(error, true);
    rules.push(rule); errors = []; dirty = true; render(); message('规则已加入，保存后生效。');
  };
  find('save').onclick = () => busy(find('save'), async () => {
    const snapshot = await invoke('desktop_save', { config: { enabled: find('enabled').checked, rules } });
    load(snapshot);
    const failed = snapshot.errors.filter(Boolean).length;
    message(failed ? `已保存，${failed} 条规则未启用，请检查运行状态。` : '已保存并应用。', failed > 0);
  });
  window.__TAURI__.event.listen('mini68-hotkey-error', ({ payload }) => {
    if (panel.open) message(payload, true); else open.title = payload;
  });
});
