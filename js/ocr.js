/* ============================================================
   Show Floor — card reading
   1. AI vision through the Supabase edge function (best quality)
   2. Tesseract on-device fallback + heuristic field parser
   3. No signal? The image is queued and parsed when we reconnect.
   ============================================================ */

/* ---- image prep: downscale, correct orientation, compress ---- */
async function prepImage(file, max = 1600, quality = 0.82) {
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
  const dataUrl = await blobToDataUrl(blob);
  return { blob, dataUrl, w, h, canvas: c };
}

function loadBitmap(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => imgFallback(file));
  }
  return imgFallback(file);
}
function imgFallback(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = rej;
    im.src = url;
  });
}
function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

/* ---- contrast boost for the on-device path ---- */
function binarize(canvas) {
  const ctx = canvas.getContext('2d');
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const p = d.data;
  let sum = 0;
  for (let i = 0; i < p.length; i += 4) {
    const g = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114);
    p[i] = p[i + 1] = p[i + 2] = g;
    sum += g;
  }
  const mean = sum / (p.length / 4);
  const t = mean * 0.92;
  for (let i = 0; i < p.length; i += 4) {
    const v = p[i] > t ? 255 : Math.max(0, p[i] * 0.45);
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return canvas;
}

/* ---- Tesseract lazy load ---- */
let tessP = null;
function loadTesseract() {
  if (tessP) return tessP;
  tessP = new Promise((res, rej) => {
    if (window.Tesseract) return res(window.Tesseract);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = () => res(window.Tesseract);
    s.onerror = () => rej(new Error('offline'));
    document.head.appendChild(s);
  }).catch(e => { tessP = null; throw e; });
  return tessP;
}

async function ocrLocal(canvas, onProgress) {
  const T = await loadTesseract();
  const c = binarize(canvas);
  const res = await T.recognize(c, 'eng', {
    logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress(0.3 + m.progress * 0.7); }
  });
  return res?.data?.text || '';
}

/* ---- heuristic parser ---- */
const RE = {
  email: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  url: /((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s,;]*)?)/gi,
  phone: /(\+?\d[\d\s()\-.]{7,}\d)/g,
  li: /(linkedin\.com\/(?:in|company)\/[a-z0-9\-_%.]+)/gi
};
const TITLE_WORDS = /\b(ceo|cto|coo|cfo|cmo|cio|founder|co-?founder|president|vice\s?president|vp|svp|avp|evp|director|head|chief|manager|mgr|lead|owner|partner|principal|consultant|specialist|executive|officer|engineer|developer|architect|analyst|supervisor|coordinator|representative|advisor|associate|assistant|general\s?manager|gm|md|managing\s?director|business\s?development|sales|marketing|revenue|operations|account|procurement|purchas|distribution|contract|product|technology|technical|regional|country|global|senior|sr\.?|jr\.?)\b/i;
const COMPANY_WORDS = /\b(llc|l\.l\.c|ltd|limited|inc|incorporated|corp|corporation|co\.?|company|gmbh|plc|pvt|private|holding|holdings|group|travel|tours?|tourism|hotels?|resorts?|hospitality|dmc|technolog|technologies|solutions?|systems?|services?|software|labs?|ventures?|partners?|international|global|worldwide|agency|consult|trading|est|establishment|w\.?l\.?l|fzco|fz-?llc|fze|sarl|s\.a|b\.v|a\.s|ag|spa|srl|oy|ab)\b/i;
const NOISE = /^(tel|t|p|ph|phone|mob|m|mobile|cell|fax|f|e|email|e-?mail|web|w|www|address|add|a|office|direct|d|skype|whatsapp|wa)[\s:.\-]*$/i;

function stripLabel(s) {
  return s.replace(/^\s*(tel|telephone|t|p|ph|phone|mob|mobile|m|cell|fax|f|e|email|e-?mail|web|w|url|addr|address|a|office|off|direct|d|dir|hq)\s*[:.\-–|]\s*/i, '').trim();
}
function titleCaseName(s) {
  return s.split(/\s+/).map(w => {
    if (w.length <= 3 && w === w.toUpperCase() && /^[A-Z.]+$/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function parseCard(text) {
  const raw = (text || '').replace(/\r/g, '');
  const lines = raw.split('\n').map(l => l.replace(/\s{2,}/g, ' ').trim())
    .filter(l => l.length > 1 && !NOISE.test(l));
  const f = {
    full_name: '', designation: '', company: '', email: '', phone: '', phone_2: '',
    website: '', linkedin: '', address: '', raw_text: raw.trim()
  };

  const emails = [...new Set((raw.match(RE.email) || []).map(e => e.toLowerCase()))];
  f.email = emails[0] || '';

  const lis = [...new Set((raw.match(RE.li) || []).map(s => s.toLowerCase()))];
  if (lis[0]) f.linkedin = 'https://' + lis[0].replace(/^https?:\/\//, '');

  const phones = [];
  for (const m of raw.match(RE.phone) || []) {
    const digits = m.replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length < 8) continue;
    if (/^(19|20)\d{2}$/.test(digits)) continue;
    const clean = m.trim().replace(/\s{2,}/g, ' ');
    if (!phones.some(p => p.replace(/\D/g, '') === digits.replace(/\D/g, ''))) phones.push(clean);
  }
  f.phone = phones[0] || '';
  f.phone_2 = phones[1] || '';

  const urls = [...new Set((raw.match(RE.url) || []))]
    .map(u => u.replace(/[.,;]$/, ''))
    .filter(u => !/@/.test(u) && !/linkedin\.com/i.test(u))
    .filter(u => /\.(com|net|org|io|ae|co|in|uk|de|fr|sa|qa|om|bh|kw|eg|sg|my|th|id|ph|vn|jp|cn|hk|tr|es|it|nl|se|ch|au|nz|us|ca|travel|tech|ai|app|biz|info|me|cc|eu|asia|global|group|agency)\b/i.test(u))
    .filter(u => !emails.some(e => e.endsWith(u.toLowerCase().replace(/^www\./, ''))));
  if (urls[0]) f.website = urls[0].replace(/^https?:\/\//, '').replace(/\/$/, '');

  /* name + designation + company from line shape */
  const cands = lines.map(stripLabel).filter(l =>
    l && !RE.email.test(l) && !/\d{4,}/.test(l) && l.length < 60);
  RE.email.lastIndex = 0;

  let nameIdx = -1;
  for (let i = 0; i < cands.length; i++) {
    const l = cands[i];
    const words = l.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (TITLE_WORDS.test(l) || COMPANY_WORDS.test(l)) continue;
    if (!/^[A-Za-z.''\- ]+$/.test(l)) continue;
    const capish = words.filter(w => /^[A-Z]/.test(w)).length >= words.length - 1;
    if (!capish) continue;
    nameIdx = i; f.full_name = titleCaseName(l); break;
  }

  for (let i = 0; i < cands.length; i++) {
    if (i === nameIdx) continue;
    if (TITLE_WORDS.test(cands[i]) && !COMPANY_WORDS.test(cands[i])) { f.designation = cands[i]; break; }
  }
  for (let i = 0; i < cands.length; i++) {
    if (i === nameIdx || cands[i] === f.designation) continue;
    if (COMPANY_WORDS.test(cands[i])) { f.company = cands[i]; break; }
  }
  if (!f.company && f.website) {
    const host = f.website.replace(/^www\./, '').split('/')[0].split('.')[0];
    if (host && host.length > 2) f.company = titleCaseName(host.replace(/[-_]/g, ' '));
  }
  if (!f.company) {
    const big = lines.find(l => l !== f.full_name && l !== f.designation && l.length > 3 &&
      l === l.toUpperCase() && /[A-Z]{3,}/.test(l));
    if (big) f.company = titleCaseName(big);
  }
  if (!f.full_name && f.email) {
    const local = f.email.split('@')[0].replace(/\d+/g, '');
    if (/[._-]/.test(local)) f.full_name = titleCaseName(local.replace(/[._-]+/g, ' ').trim());
  }

  const addr = lines.filter(l =>
    /\b(street|st\.|road|rd\.|avenue|ave|building|bldg|tower|floor|fl\.|suite|office|p\.?o\.?\s?box|district|city|area|zone|block|dubai|abu dhabi|sharjah|riyadh|jeddah|doha|kuwait|muscat|manama|cairo|london|singapore|mumbai|delhi|bangalore|pune)\b/i.test(l) &&
    l !== f.company && l !== f.full_name && l !== f.designation);
  if (addr.length) f.address = addr.slice(0, 3).join(', ');

  return f;
}

/* ---- orchestrator ---- */
async function readCard(file, { onStage } = {}) {
  const stage = (s, p) => onStage && onStage(s, p);
  stage('prep', 0.05);
  const prep = await prepImage(file);

  if (!navigator.onLine) {
    stage('queued', 1);
    return { fields: parseCard(''), blob: prep.blob, dataUrl: prep.dataUrl, engine: 'queued', note: 'No signal. Card saved, text will be read when you reconnect.' };
  }

  const configured = await Store.ocrCheck();
  if (configured) {
    try {
      stage('ai', 0.25);
      const out = await Store.ocrRemote(prep.dataUrl, 'image/jpeg');
      if (out?.ok && out.fields) {
        stage('done', 1);
        return { fields: normalize(out.fields), blob: prep.blob, dataUrl: prep.dataUrl, engine: 'ai:' + (out.provider || 'vision') };
      }
    } catch (e) {
      console.warn('ai ocr failed, falling back', e);
    }
  }

  try {
    stage('local', 0.3);
    const text = await ocrLocal(prep.canvas, p => stage('local', p));
    stage('done', 1);
    const fields = parseCard(text);
    return { fields, blob: prep.blob, dataUrl: prep.dataUrl, engine: 'device', note: configured ? 'AI read failed, used on-device text recognition. Check the fields.' : 'Read on device. Add the AI key for sharper results.' };
  } catch (e) {
    stage('manual', 1);
    return { fields: parseCard(''), blob: prep.blob, dataUrl: prep.dataUrl, engine: 'manual', note: 'Could not read the card automatically. Type the details in.' };
  }
}

function normalize(f) {
  const o = {
    full_name: (f.full_name || '').trim(), designation: (f.designation || '').trim(),
    company: (f.company || '').trim(), email: (f.email || '').trim().toLowerCase(),
    phone: (f.phone || '').trim(), phone_2: (f.phone_2 || '').trim(),
    website: (f.website || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, ''),
    linkedin: (f.linkedin || '').trim(), address: (f.address || '').trim(),
    raw_text: (f.raw_text || '').trim()
  };
  if (o.linkedin && !/^https?:/.test(o.linkedin)) o.linkedin = 'https://' + o.linkedin.replace(/^\/+/, '');
  return o;
}

/* ---- retry parse for queued cards once back online ---- */
async function readQueued(blob) {
  const prep = await prepImage(blob);
  if (await Store.ocrCheck()) {
    try {
      const out = await Store.ocrRemote(prep.dataUrl, 'image/jpeg');
      if (out?.ok && out.fields) return { fields: normalize(out.fields), engine: 'ai' };
    } catch (e) {}
  }
  const text = await ocrLocal(prep.canvas);
  return { fields: parseCard(text), engine: 'device' };
}

window.OCR = { readCard, readQueued, parseCard, prepImage, normalize };
