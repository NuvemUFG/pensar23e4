/* NDH25 · camada de integração da revisão de provas.
   Com endpoint configurado (Google Apps Script publicado como app da Web), tudo vai para o Drive.
   Sem endpoint, funciona em modo demonstração: as submissões ficam neste navegador. */
(function () {
  const LS = { subs: 'ndh25-subs', ep: 'ndh25-endpoint', admin: 'ndh25-admin' };
  const SALT = 'ndh25-prova-v1';
  const pad = n => String(n).padStart(2, '0');
  const strip = s => (s || '').replace(/<sup[^>]*>[^<]*<\/sup>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  const norm = s => strip(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[“”"'’‘]/g, '"').replace(/\s+/g, ' ').trim();
  const readLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const NDH = {
    strip, norm, pad,
    cfg() { const C = window.NDH_CONFIG || {}; return { endpoint: localStorage.getItem(LS.ep) || C.endpoint || '', admin: localStorage.getItem(LS.admin) || '' }; },
    setCfg(ep, admin) { ep != null && localStorage.setItem(LS.ep, ep.trim()); admin != null && localStorage.setItem(LS.admin, admin.trim()); },
    online() { return !!this.cfg().endpoint; },
    async data() {
      if (this._d) return this._d;
      if (this.online()) {
        const q = new URLSearchParams(location.search); const c = this.cfg();
        const r = c.admin ? await this.get({ action: 'livro', k: c.admin }) : (q.get('art') && q.get('chave')) ? await this.get({ action: 'capitulo', art: q.get('art'), chave: q.get('chave') }) : { ok: false, erro: 'Use o link pessoal enviado por e-mail.' };
        if (!r.ok) throw new Error(r.erro || 'sem acesso'); this._d = r.livro; return this._d;
      }
      this._d = await (await fetch('livro/livro.json')).json(); return this._d;
    },
    articles(d) { return d.parts.flatMap(p => p.articles.map(a => { a._partNum = p.num; a._partTitle = p.title; return a; })); },

    /* ---------- acesso por autor ---------- */
    async token(art, email) {
      const b = new TextEncoder().encode(`${SALT}|${art}|${(email || '').trim().toLowerCase()}`);
      const h = await crypto.subtle.digest('SHA-256', b);
      return [...new Uint8Array(h)].slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join('');
    },
    async accessList() {
      const d = await this.data(); const out = [];
      for (const a of this.articles(d)) for (let i = 0; i < a.authors.length; i++) {
        const x = a.authors[i]; const t = await this.token(a.id, x.email || x.name);
        out.push({ art: a.id, num: a.num, code: `${a.id}-A${i + 1}`, name: x.name, email: x.email, token: t, portal: `Portal do Autor.dc.html?art=${a.id}&chave=${t}`, form: `Formulario de Revisao.dc.html?art=${a.id}&chave=${t}` });
      }
      return out;
    },
    async checkAccess(art, t) {
      if (!art || !t) return null;
      if (this.online()) { try { const r = await this.get({ action: 'acesso', art, chave: t }); return r.ok ? { name: r.autor.nome, email: r.autor.email, code: r.autor.codigo_autor } : null; } catch (e) { return null; } }
      const list = await this.accessList(); return list.find(x => x.art === art && x.token === t) || null;
    },

    /* ---------- parágrafos com o mesmo código da prova (ex.: 03·12) ---------- */
    paragraphs(a) {
      const out = []; let pn = 0; let sec = '';
      a.blocks.forEach((b, i) => {
        if (b.t === 'h') { sec = strip(b.h); out.push({ i, t: 'h', text: sec, cod: null }); return; }
        if (['p', 'q', 'li', 'v', 'ref'].includes(b.t)) { const cod = `${pad(a.num)}·${++pn}`; out.push({ i, t: b.t, cod, text: strip(b.h), sec }); }
        else if (b.t === 'cap') out.push({ i, t: 'cap', text: strip(b.h), cod: null, sec });
      });
      return out;
    },
    normCod(c, num) { const m = String(c || '').match(/(\d+)\D+(\d+)/); if (m) return `${pad(+m[1])}·${+m[2]}`; const n = String(c || '').match(/^\s*(\d+)\s*$/); return n && num ? `${pad(num)}·${+n[1]}` : ''; },

    /* ---------- submissões ---------- */
    async submit(rec, files) {
      if (this.online()) {
        const enc = await Promise.all((files || []).map(([name, f]) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name, mime: f.type || 'application/octet-stream', b64: String(r.result).split(',')[1] }); r.onerror = rej; r.readAsDataURL(f); })));
        const r = await fetch(this.cfg().endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'submit', rec, files: enc }) });
        return await r.json();
      }
      const subs = readLS(LS.subs, []);
      const n = subs.filter(s => s.codigo === rec.codigo).length + 1;
      const subId = `${rec.codigo}-SUB-${String(n).padStart(3, '0')}`;
      const s = { ...rec, subId, recebido_em: new Date().toISOString(), arquivos: (files || []).map(([name, f]) => ({ name, size: f.size, type: f.type })), status: {}, parecer: null };
      // renomeia revisões com o número da submissão
      (s.C || []).forEach((r, k) => { r.codigo = `${subId}-REV-${pad(k + 1)}`; });
      subs.push(s); writeLS(LS.subs, subs);
      return { ok: true, subId, pasta: `NDH25 Prova dos Autores / ${rec.codigo} / ${subId}`, demo: true };
    },
    async list(art, t) {
      if (this.online()) { const r = await this.get(t ? { action: 'lista', art, chave: t } : { action: 'admin', k: this.cfg().admin }); return r.subs || []; }
      const subs = readLS(LS.subs, []); return art ? subs.filter(s => s.codigo === art) : subs;
    },
    async update(subId, patch) {
      if (this.online()) return this.post({ action: 'atualizar', k: this.cfg().admin, subId, patch });
      const subs = readLS(LS.subs, []); const s = subs.find(x => x.subId === subId); if (!s) return { ok: false };
      Object.keys(patch).forEach(k => { s[k] = k === 'status' ? { ...(s.status || {}), ...patch.status } : patch[k]; });
      writeLS(LS.subs, subs); return { ok: true };
    },
    async get(q) { const u = new URL(this.cfg().endpoint); Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, v)); return (await fetch(u)).json(); },
    async post(b) { return (await fetch(this.cfg().endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(b) })).json(); },

    /* ---------- verificações determinísticas (antes do agente) ---------- */
    prechecks(s, a) {
      const P = this.paragraphs(a); const full = norm(P.map(p => p.text).join(' ')); const out = [];
      const add = (codigo, cat, nivel, msg) => out.push({ codigo, cat, nivel, msg });
      (s.C || []).forEach(r => {
        const cod = this.normCod(r['2_paragrafo'], a.num); const p = P.find(x => x.cod === cod);
        const atual = r['4_atual'] || '', novo = r['5_corrigido'] || '';
        r._cod = cod; r._par = p ? p.text : '';
        if (!p) add(r.codigo, 'localização', 'alto', `Parágrafo "${r['2_paragrafo'] || '—'}" não existe no capítulo.`);
        else if (atual && !norm(p.text).includes(norm(atual))) add(r.codigo, 'localização', 'médio', 'O trecho atual não foi encontrado literalmente no parágrafo indicado.');
        if (!novo) add(r.codigo, 'conteúdo', 'alto', 'Trecho corrigido vazio.');
        const ra = atual.length || 1, rn = novo.length;
        if (rn > 400 && rn / ra > 1.5) add(r.codigo, 'projeto', 'médio', `Acréscimo extenso (${rn} caracteres): a prova aceita correções pontuais.`);
        if (/\([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ ;,.-]+,\s*\d{4}/.test(novo) && !/\([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ ;,.-]+,\s*\d{4}/.test(atual)) add(r.codigo, 'integridade', 'médio', 'Nova citação autor-data: confirmar que consta nas referências.');
        if (/\b(\d{1,3}([.,]\d+)?\s?%|\d{4})\b/.test(novo) && novo.replace(/\D/g, '') !== atual.replace(/\D/g, '')) add(r.codigo, 'integridade', 'baixo', 'Alteração de números, datas ou percentuais: pedir fonte.');
      });
      (s.B || []).forEach((b, i) => {
        const orig = a.authors[i];
        if (!orig) add(b.codigo, 'autoria', 'alto', 'Autor não consta no original: inclusão exige anuência de todos os autores e da organização.');
        else if (norm(orig.name) !== norm(b['1_nome'])) add(b.codigo, 'autoria', 'baixo', `Nome alterado de "${orig.name}" para "${b['1_nome']}".`);
        if (!b['8_foto']) add(b.codigo, 'imagem', 'baixo', 'Foto de identificação não enviada.');
        if (b['6_bio'] && b['6_bio'].split(/\s+/).length > 80) add(b.codigo, 'projeto', 'baixo', 'Minibiografia acima de 80 palavras.');
      });
      if (s.B && s.B.length < a.authors.length) add(`${a.id}-B`, 'autoria', 'alto', 'Há autores do original ausentes: exclusão exige anuência de todos.');
      const D = s.D || {};
      if (!D.D07) add('D07', 'integridade', 'alto', 'Declaração de uso de IA assinada não enviada.');
      if (D.D01 === 'sim' && (D.D03 || []).some(f => /Geração de texto|Geração ou edição de imagem/.test(f))) add('D03', 'integridade', 'médio', 'Uso de IA para gerar texto ou imagem: exige descrição da revisão humana e pode requerer nota no capítulo.');
      if (D.D01 === 'sim' && !D.D05) add('D05', 'integridade', 'médio', 'Uso de IA sem descrição da revisão humana.');
      const E = s.E || {};
      if (E.E01 === 'outra' && E.E02) { if (!full.includes(norm(E.E02))) add('E02', 'projeto', 'médio', 'A frase sugerida para o card não é literal do capítulo.'); if (E.E02.length > 230) add('E02', 'projeto', 'baixo', 'Frase do card acima de 230 caracteres.'); }
      (s.F || []).forEach(f => {
        if (!f['4_alt']) add(f.codigo, 'acessibilidade', 'alto', 'Imagem sem texto alternativo.');
        else if (f['4_alt'].length > 250) add(f.codigo, 'acessibilidade', 'médio', 'Texto alternativo acima de 250 caracteres.');
        else if (/^(imagem|foto|figura)\b/i.test(f['4_alt'])) add(f.codigo, 'acessibilidade', 'baixo', 'O texto alternativo não precisa começar com "imagem de" ou "foto de".');
        if (!f['2_legenda']) add(f.codigo, 'acessibilidade', 'médio', 'Imagem sem legenda.');
        if (!f['3_credito']) add(f.codigo, 'integridade', 'médio', 'Imagem sem fonte e crédito.');
        if (!f['5_autoriza']) add(f.codigo, 'integridade', 'alto', 'Autorização de uso de imagem não confirmada.');
      });
      return out;
    },

    /* ---------- agente revisor ---------- */
    SYSTEM: `Você é o agente de verificação editorial da prova dos autores do livro "25 anos do Núcleo de Direitos Humanos: trajetórias, desafios e perspectivas para a promoção da dignidade humana" (NDH/UFG). A cada submissão, decide o que deve mudar na versão de provas e redige sugestões cordiais aos autores.
Regras do projeto:
- Prova é fase de correção pontual: ortografia, dados, nomes, citações, referências. Reescritas extensas, novos argumentos ou seções devem ser recusados ou negociados.
- Normas: ABNT NBR 6023:2018 (referências), NBR 10520:2023 (citações autor-data; nomes em maiúsculas dentro de parênteses), pt-BR conforme o VOLP/ABL.
- Destaque do card de divulgação: sempre trecho literal do capítulo, até 230 caracteres.
- Acessibilidade (WCAG 2.2 AA, PDF/UA): toda imagem com texto alternativo de até 250 caracteres que descreva o conteúdo relevante; legenda e fonte; informação nunca só por cor; tabelas com cabeçalho; siglas por extenso na primeira ocorrência; linguagem que não discrimine.
- Integridade: citação nova precisa estar nas referências; dados alterados precisam de fonte; mudança de autoria exige anuência de todos; uso de IA deve ser declarado com ferramenta, finalidade e revisão humana; texto ou imagem gerados por IA não podem ser apresentados como autorais; imagens exigem autorização de uso e das pessoas retratadas.
Responda SOMENTE com JSON válido, sem comentários, neste formato:
{"resumo":"2 frases","itens":[{"codigo":"código da revisão","paragrafo":"03·12","decisao":"aplicar|ajustar|recusar|consultar","categoria":"ortografia|dado|citação|referência|autoria|acessibilidade|integridade|projeto|outra","motivo":"curto","texto_final":"texto que deve entrar na prova quando decisao=aplicar ou ajustar; vazio nos demais","sugestao_autor":"frase cordial ao autor, vazia se nada a sugerir"}],"pendencias":[{"campo":"código","nivel":"alto|médio|baixo","texto":"o que falta ou está incoerente"}],"mensagem_autor":"mensagem curta, acolhedora, em pt-BR, com as sugestões e pendências"}`,
    async agent(s, a, onStatus, save = true) {
      const pre = this.prechecks(s, a);
      const revs = (s.C || []).map(r => ({ codigo: r.codigo, paragrafo: r._cod || r['2_paragrafo'], tipo: r['3_tipo'], atual: r['4_atual'], corrigido: r['5_corrigido'], justificativa: r['6_justificativa'], paragrafo_na_prova: (r._par || '').slice(0, 1400) }));
      const payload = { capitulo: { codigo: a.id, titulo: strip(a.titleClean), autores: a.authors.map(x => x.name) }, revisoes: revs, autoria: s.B, ia: s.D, card: { atual: strip(a.summary.destaque), ...s.E }, imagens: s.F, fotos_capitulo: s.H, observacoes: s.G01, verificacoes_automaticas: pre };
      onStatus && onStatus('Consultando o agente…');
      if (this.online()) { const r = save ? await this.post({ action: 'verificar', k: this.cfg().admin, subId: s.subId }) : await this.post({ action: 'previa', art: a.id, chave: s.token, rec: s }); if (!r.ok) throw new Error(r.erro || 'agente indisponível'); return r.parecer; }
      if (!window.claude || !window.claude.complete) throw new Error('Agente indisponível neste ambiente.');
      const txt = await window.claude.complete({ model: 'claude-sonnet-4-5', max_tokens: 6000, system: this.SYSTEM, messages: [{ role: 'user', content: 'Submissão ' + s.subId + ':\n' + JSON.stringify(payload) }] });
      const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error('Resposta do agente sem JSON.');
      const parecer = JSON.parse(m[0]); parecer.pre = pre; parecer.gerado_em = new Date().toISOString();
      if (save) await this.update(s.subId, { parecer });
      return parecer;
    },

    /* ---------- versão com alterações ---------- */
    decLabel(d) {
      const m = { rascunho: ['Proposta ainda não enviada', 'wait'], pendente: ['Aguardando análise', 'wait'], aprovada: ['Aplicada na prova', 'ok'], ajustada: ['Aplicada com ajuste', 'ok'], recusada: ['Não aplicada', 'no'], consultar: ['Em consulta ao autor', 'ask'],
        'agente:aplicar': ['Agente: aplicar · aguarda organização', 'wait'], 'agente:ajustar': ['Agente: ajustar · aguarda organização', 'ask'], 'agente:recusar': ['Agente: não aplicar · aguarda organização', 'no'], 'agente:consultar': ['Agente: consultar autor', 'ask'] };
      const r = m[d] || [d, 'wait']; return { label: r[0], kind: r[1] };
    },
    decisionOf(s, code) { const st = (s.status || {})[code]; if (st) return st; const it = s.parecer && (s.parecer.itens || []).find(x => x.codigo === code); return it ? 'agente:' + it.decisao : 'pendente'; },
    changes(subs, a) {
      const list = [];
      subs.forEach(s => (s.C || []).forEach(r => {
        const it = s.parecer && (s.parecer.itens || []).find(x => x.codigo === r.codigo);
        const dec = this.decisionOf(s, r.codigo);
        list.push({ subId: s.subId, codigo: r.codigo, cod: this.normCod(r['2_paragrafo'], a.num), atual: r['4_atual'] || '', novo: (it && it.texto_final) || r['5_corrigido'] || '', original: r['5_corrigido'] || '', dec, motivo: it ? it.motivo : '', sugestao: it ? it.sugestao_autor : '', tipo: r['3_tipo'] || '' });
      }));
      return list;
    },
    appliedVersion(a, changes) {
      const P = this.paragraphs(a);
      return P.map(p => {
        if (!p.cod) return { ...p, segs: [{ k: 'eq', t: p.text }], changes: [] };
        const ch = changes.filter(c => c.cod === p.cod);
        let segs = [{ k: 'eq', t: p.text }];
        ch.forEach(c => {
          if (!c.atual) return;
          const live = /aprovad|aplicar|ajustar/.test(c.dec) && !/recus/.test(c.dec);
          for (let i = 0; i < segs.length; i++) {
            const sg = segs[i]; if (sg.k !== 'eq') continue;
            const idx = sg.t.indexOf(c.atual.trim()); if (idx < 0) continue;
            const before = sg.t.slice(0, idx), after = sg.t.slice(idx + c.atual.trim().length);
            const mid = live ? [{ k: 'del', t: c.atual.trim(), c }, { k: 'ins', t: c.novo, c }] : [{ k: 'mark', t: c.atual.trim(), c }];
            segs.splice(i, 1, { k: 'eq', t: before }, ...mid, { k: 'eq', t: after }); c._found = true; break;
          }
        });
        return { ...p, segs: segs.filter(x => x.t), changes: ch };
      });
    }
  };
  window.NDH = NDH;
})();
