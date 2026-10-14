/*! Analysis-Tracker - Copyright (c) 2026 Sanskar Nanda - MIT License (see LICENSE). https://github.com/Sanskar-hep */
/* Splits a pasted e-mail into separate review comments. Pure text rules: no network, nothing leaves the browser. */
(function (root) {
  'use strict';
  const SEP = /^\s*[-—–_=*~]{2,}\s*$/;
  const HDR = /^\s*(From|Sent|To|Cc|Bcc|Subject|Date|Reply-To)\s*:/i;
  const GREET = /^\s*(hi|hello|dear|hey)\b[^.?!]{0,60}[,!:]?\s*$/i;
  const SIGN = /^\s*(cheers|thanks|thank you|many thanks|best|best regards|regards|kind regards|best wishes|sincerely|yours)\b[^.?!]{0,50}$/i;
  const BULLET = /^\s*(?:\d{1,2}[.)]|[-*•])\s+/;
  // "Sec 3.1:", "Tab 10:", "Fig 10:", "Lines 165ff:", "L390:", "App B:", "General comment:" ...
  const LOC = /^\s*((?:general\s+comments?|general)|(?:sec(?:tion)?s?\.?\s*[A-Z]?\d[\d.]*)|(?:tab(?:le)?s?\.?\s*\d+(?:\.\d+)*)|(?:fig(?:ure)?s?\.?\s*\d+(?:\.\d+)*[a-z]?)|(?:lines?\.?\s*\d+\w*)|(?:l\.?\s*\d+\w*)|(?:app(?:endix)?\.?\s*[A-Z]\d*)|(?:eq(?:uation)?\.?\s*\d+(?:\.\d+)*))\s*[:\-–—]\s+/i;
  const LABEL = /^\s*([A-Z][^:.?!]{2,45}):\s+(?=\S)/;     // a short topic label such as "Lepton correction factors:"

  const clean = s => s.replace(/\s+/g, ' ').trim();
  const words = s => s.split(/\s+/).filter(Boolean).length;

  function refs(text) {
    const figs = [...text.matchAll(/\bfig(?:ure)?s?\.?\s*(\d+(?:\.\d+)*[a-z]?)\b/gi)].map(m => m[1].toLowerCase());
    const slides = [...text.matchAll(/\bslides?\.?\s*(\d+)\b/gi)].map(m => m[1]);
    return {figs: [...new Set(figs)], slides: [...new Set(slides)]};
  }

  /* paragraph -> one or more raw comment strings (handles numbered / bulleted lists) */
  function splitParagraph(lines) {
    const bulletLines = lines.filter(l => BULLET.test(l)).length;
    if (bulletLines >= 2 || (bulletLines === 1 && BULLET.test(lines[0]) && lines.length > 1)) {
      const out = [];
      for (const l of lines) { if (BULLET.test(l) || !out.length) out.push(l.replace(BULLET, '')); else out[out.length - 1] += ' ' + l; }
      return out.map(clean).filter(Boolean);
    }
    return [clean(lines.join(' ').replace(BULLET, ''))].filter(Boolean);
  }

  function parseEmail(input) {
    const lines = String(input || '').replace(/\r/g, '').split('\n').map(l => l.replace(/^\s*(>\s*)+/, ''));
    // ---- where do the comments start? after the last separator line (if a substantial text follows), else after the headers
    let start = 0, lastSep = -1, lastHdr = -1;
    lines.forEach((l, i) => { if (SEP.test(l)) lastSep = i; if (HDR.test(l)) lastHdr = i; });
    const after = i => lines.slice(i + 1).join('\n').trim().length;
    if (lastSep >= 0 && after(lastSep) >= 60) start = lastSep + 1; else if (lastHdr >= 0) start = lastHdr + 1;
    // ---- sender: the last "From:" header before the comments
    let from = '';
    for (let i = 0; i < start; i++) { const m = lines[i].match(/^\s*From\s*:\s*(.*)$/i); if (m) from = clean(m[1].replace(/<[^>]*>/g, '').replace(/["']/g, '')); }
    // ---- paragraphs
    const split = text => { const ps = []; let c = []; for (const l of text.split('\n')) { if (!l.trim()) { if (c.length) ps.push(c); c = []; } else c.push(l.trim()); } if (c.length) ps.push(c); return ps; };
    const pre = split(lines.slice(0, start).join('\n')), body = split(lines.slice(start).join('\n'));

    const ignored = [];
    pre.forEach(p => { const t = clean(p.filter(l => !HDR.test(l) && !SEP.test(l)).join(' ')); if (t && !GREET.test(t)) ignored.push({text: t, reason: 'before the comments (cover note / header)'}); });

    const items = [];
    for (const p of body) {
      const kept = p.filter(l => !HDR.test(l) && !SEP.test(l)); if (!kept.length) continue;
      for (const raw of splitParagraph(kept)) {
        if (GREET.test(raw)) { ignored.push({text: raw, reason: 'greeting'}); continue; }
        if (SIGN.test(raw)) { ignored.push({text: raw, reason: 'sign-off'}); continue; }
        let location = '', text = raw, m = raw.match(LOC);
        if (m) { location = clean(m[1]); text = raw.slice(m[0].length); }
        else if ((m = raw.match(LABEL)) && words(m[1]) <= 4 && raw.length - m[0].length > 20) { location = clean(m[1]); text = raw.slice(m[0].length); }
        if (!location && (m = raw.match(/^\s*((?:sec(?:tion)?s?\.?\s*\d[\d.]*)|(?:tab(?:le)?s?\.?\s*\d+(?:\.\d+)*)|(?:fig(?:ure)?s?\.?\s*\d+(?:\.\d+)*[a-z]?)|(?:app(?:endix)?\.?\s*[A-Z]\d*))\b/i))) location = clean(m[1]);   // text stays whole
        const heading = !location && words(raw) <= 6 && !/[.?!]$/.test(raw);
        const r = refs(raw);
        items.push({text: clean(text), location, raw, figs: r.figs, slides: r.slides, include: !heading, note: heading ? 'looks like a heading' : ''});
      }
    }
    return {from, items, ignored};
  }
  root.parseEmail = parseEmail;
  if (typeof module !== 'undefined') module.exports = {parseEmail};
})(typeof window !== 'undefined' ? window : globalThis);
