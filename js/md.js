// Conversor mínimo de Markdown a HTML (encabezados, listas, tablas, negrita, cursiva, citas).
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(«"¿¡])\*([^*\s][^*]*?)\*(?=[\s.,;:)»"?!]|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

const esFilaTabla = l => /^\s*\|.*\|\s*$/.test(l);
const celdas = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export function md(texto) {
  const lineas = String(texto ?? '').replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,5})\s+(.*)$/))) {
      const n = Math.min(Math.max(m[1].length, 3), 5);
      html += `<h${n}>${inline(m[2])}</h${n}>`; i++; continue;
    }
    if (esFilaTabla(l) && i + 1 < lineas.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lineas[i + 1]) && lineas[i + 1].includes('-')) {
      const cab = celdas(l); i += 2;
      let filas = '';
      while (i < lineas.length && esFilaTabla(lineas[i])) { filas += '<tr>' + celdas(lineas[i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'; i++; }
      html += `<div class="tabla"><table><thead><tr>${cab.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></div>`;
      continue;
    }
    if (/^\s*>\s?/.test(l)) {
      let q = [];
      while (i < lineas.length && /^\s*>\s?/.test(lineas[i])) { q.push(lineas[i].replace(/^\s*>\s?/, '')); i++; }
      html += `<blockquote>${md(q.join('\n'))}</blockquote>`; continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      // Lista (con un nivel de anidamiento por sangría)
      const items = [];
      while (i < lineas.length && (/^\s*([-*•]|\d+[.)])\s+/.test(lineas[i]) || (/^\s{2,}\S/.test(lineas[i]) && items.length))) {
        const mm = lineas[i].match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
        if (mm) items.push({ ind: mm[1].length, ord: /\d/.test(mm[2]), txt: mm[3] });
        else items[items.length - 1].txt += ' ' + lineas[i].trim();
        i++;
      }
      const base = items[0].ind;
      const render = (desde, ind) => {
        const ord = items[desde].ord;
        let out = ord ? '<ol>' : '<ul>', k = desde;
        while (k < items.length && items[k].ind >= ind) {
          if (items[k].ind > ind) { const [h, nk] = render(k, items[k].ind); out = out.replace(/<\/li>$/, '') + h + '</li>'; k = nk; continue; }
          out += `<li>${inline(items[k].txt)}</li>`; k++;
        }
        return [out + (ord ? '</ol>' : '</ul>'), k];
      };
      html += render(0, base)[0];
      continue;
    }
    const p = [];
    while (i < lineas.length && lineas[i].trim() && !/^(#{1,5}\s|\s*>|\s*([-*•]|\d+[.)])\s+)/.test(lineas[i]) && !esFilaTabla(lineas[i])) { p.push(lineas[i].trim()); i++; }
    html += `<p>${inline(p.join(' '))}</p>`;
  }
  return html;
}
