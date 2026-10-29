(() => {
  const keys = [
    ...Array.from({ length: 26 }, (_, i) => [65 + i, String.fromCharCode(65 + i)]),
    ...Array.from({ length: 10 }, (_, i) => [48 + i, String(i)]),
    ...Array.from({ length: 12 }, (_, i) => [112 + i, `F${i + 1}`]),
    [36, 'Home'], [35, 'End'], [33, 'Page Up'], [34, 'Page Down'],
    [37, '←'], [38, '↑'], [39, '→'], [40, '↓'], [45, 'Insert'], [46, 'Delete'],
    [8, 'Backspace'], [9, 'Tab'], [13, 'Enter'], [27, 'Esc'], [32, 'Space'],
    [186, ';'], [187, '='], [188, ','], [189, '-'], [190, '.'], [191, '/'],
    [192, '`'], [219, '['], [220, '\\'], [221, ']'], [222, "'"],
  ];
  const names = new Map(keys);
  const modifiers = [[2, 'Ctrl'], [1, 'Alt'], [4, 'Shift'], [8, 'Win']];
  function label(rule) {
    return [...modifiers.filter(([bit]) => rule.modifiers & bit).map(([, name]) => name),
      names.get(rule.key)].join(' + ') + ' → ' + names.get(rule.target);
  }
  function validate(rules) {
    if (rules.length > 32) return '最多保存 32 条映射';
    const used = new Set();
    for (const rule of rules) {
      if (!Number.isInteger(rule.modifiers) || rule.modifiers < 1 || rule.modifiers > 15)
        return '每条映射至少选择一个修饰键';
      if (!names.has(rule.key) || !names.has(rule.target)) return '请选择有效按键';
      if (rule.key === 123) return 'F12 是 Windows 调试保留键，不能作为来源';
      if ((rule.modifiers & 3) === 3 && rule.key === 46) return 'Ctrl + Alt + Delete 是系统保留组合';
      const id = `${rule.modifiers}:${rule.key}`;
      if (used.has(id)) return '来源组合键重复，请先删除原规则';
      used.add(id);
    }
    return null;
  }
  const api = { keys, modifiers, label, validate };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Mini68Keys = api;
})();
