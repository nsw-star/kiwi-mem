// 📅 日历与整理 — 总开关 + 各级生成 + 日历查看 + 参数（pill-tabs）
import { get, escAttr, escHtml, todayStr } from '../api.js';
import { loadingBlock, toast, delegate, setBusy, masterSwitch } from '../ui.js';
import { loadConfig, renderConfigGroups, wireConfig, ensureModelDatalist } from '../config.js';
import { CONFIG_META } from '../config-schema.js';
import { previousCompletePeriods } from '../calendar-periods.mjs';

export default {
  title: '日历与整理',
  state: { cfg: {}, tab: 'generate' },

  async mount(root) {
    this.root = root;
    ensureModelDatalist();

    root.innerHTML = `
      <p class="page-intro">
        日历把零散对话凝成日/周/月/季/年的总结，开启注入后 AI 便知道「最近发生了什么」。
        这里可以生成、查看日历，并调整参数。
      </p>

      <div id="master-slot">${loadingBlock()}</div>

      <div class="pill-tabs" id="tabs">
        <div class="pill-tab active" data-act="tab" data-tab="generate">⚙️ 生成整理</div>
        <div class="pill-tab" data-act="tab" data-tab="view">📖 查看日历</div>
        <div class="pill-tab" data-act="tab" data-tab="settings">🎛️ 参数设置</div>
      </div>

      <div id="panel-generate"></div>
      <div id="panel-view" style="display:none"></div>
      <div id="panel-settings" style="display:none"></div>
    `;

    this.state.cfg = await loadConfig().catch(() => ({}));

    this.renderMaster();
    this.renderGenerate();
    this.renderView();
    this.renderSettings();

    delegate(root, {
      tab: (el) => this.switchTab(el.dataset.tab),

      'gen-daily': (el) =>
        this.runTask(el, () => `/admin/daily-digest${this.dateQ('d-daily')}`, '每日整理'),

      'gen-day': (el) =>
        this.runTask(el, () => `/admin/day-page${this.dateQ('d-day')}`, '日页面生成'),

      'gen-week': (el) =>
        this.runTask(el, () => `/admin/week-summary${this.weekQ()}`, '周总结'),

      'gen-month': (el) =>
        this.runTask(
          el,
          () => `/admin/month-summary?month=${encodeURIComponent(this.val('d-month'))}`,
          '月总结'
        ),

      'gen-quarter': (el) =>
        this.runTask(
          el,
          () => `/admin/quarter-summary?quarter=${encodeURIComponent(this.val('d-quarter'))}`,
          '季度总结'
        ),

      'gen-year': (el) =>
        this.runTask(
          el,
          () => `/admin/year-summary?year=${encodeURIComponent(this.val('d-year'))}`,
          '年度总结'
        ),

      'view-page': (el) => this.loadCalendarPage(el),
    });
  },

  // ---- master switch ----
  renderMaster() {
    const key = 'calendar_inject_enabled';
    const on = String(this.state.cfg[key]) === 'true';
    const slot = this.root.querySelector('#master-slot');

    slot.innerHTML = masterSwitch({
      key,
      emoji: '📅',
      label: CONFIG_META[key].label,
      on,
      desc: CONFIG_META[key].desc,
    });

    wireConfig(slot, this.state.cfg);
  },

  // ---- 参数设置 ----
  renderSettings() {
    const el = this.root.querySelector('#panel-settings');
    el.innerHTML = renderConfigGroups('calendar', this.state.cfg);
    wireConfig(el, this.state.cfg);
  },

  // ---- tab 切换 ----
  switchTab(tab) {
    this.state.tab = tab;

    this.root.querySelectorAll('.pill-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    this.root.querySelector('#panel-generate').style.display =
      tab === 'generate' ? '' : 'none';

    this.root.querySelector('#panel-view').style.display =
      tab === 'view' ? '' : 'none';

    this.root.querySelector('#panel-settings').style.display =
      tab === 'settings' ? '' : 'none';
  },

  // ---- 查看日历 ----
  renderView() {
    const today = todayStr(0);

    this.root.querySelector('#panel-view').innerHTML = `
      <div class="card">
        <div class="card-title">📖 查看已经生成的日历</div>
        <div class="card-desc">
          选择日期和页面类型，不用再看丑丑的 JSON。
        </div>

        <div class="toolbar mt16">
          <input type="date" id="v-date" value="${escAttr(today)}">

          <select id="v-type">
            <option value="day">日页面</option>
            <option value="week">周总结</option>
            <option value="month">月总结</option>
            <option value="quarter">季度总结</option>
            <option value="year">年度总结</option>
          </select>

          <button class="btn btn-primary" data-act="view-page">
            查看
          </button>
        </div>
      </div>

      <div id="calendar-view-result" class="mt16">
        <div class="card">
          <div class="card-desc">
            🦊 选好日期以后点「查看」，生成过的内容会出现在这里。
          </div>
        </div>
      </div>
    `;
  },

  async loadCalendarPage(btn) {
    const date = this.val('v-date');
    const type = this.val('v-type') || 'day';
    const resultEl = this.root.querySelector('#calendar-view-result');

    if (!date) {
      toast('请选择日期', 'err');
      return;
    }

    setBusy(btn, true, '读取中');

    try {
      const r = await get(
        `/calendar/${encodeURIComponent(date)}?type=${encodeURIComponent(type)}`
      );

      const page = r?.page;

      if (!page) {
        resultEl.innerHTML = `
          <div class="card">
            <div class="card-title">🌙 这一天还没有页面</div>
            <div class="card-desc">
              ${escHtml(date)} 没有找到已经生成的内容。
            </div>
          </div>
        `;
        return;
      }

      resultEl.innerHTML = this.renderCalendarPage(page);
    } catch (e) {
      resultEl.innerHTML = `
        <div class="card">
          <div class="card-title">读取失败</div>
          <div class="card-desc">${escHtml(e.message)}</div>
        </div>
      `;

      toast(`读取日历失败：${e.message}`, 'err');
    } finally {
      setBusy(btn, false);
    }
  },

  renderCalendarPage(page) {
    const typeLabels = {
      day: '日页面',
      week: '周总结',
      month: '月总结',
      quarter: '季度总结',
      year: '年度总结',
    };

    const typeLabel = typeLabels[page.type] || page.type || '日历';
    const title = page.title || '';
    const summary = page.summary || '';
    const diary = page.diary || '';
    const sections = Array.isArray(page.sections) ? page.sections : [];
    const keywords = Array.isArray(page.keywords) ? page.keywords : [];

    const blocks = [];

    for (const sec of sections) {
      if (!sec || typeof sec !== 'object') continue;

      const period = sec.period || '';
      const secTitle = sec.title || '';
      const content = sec.content || '';

      if (period || secTitle || content) {
        const heading = [period, secTitle].filter(Boolean).join(' · ');

        blocks.push(`
          <div class="card mt16">
            ${heading ? `<div class="card-title">${escHtml(heading)}</div>` : ''}
            ${
              content
                ? `<div style="white-space:pre-wrap;line-height:1.8;margin-top:8px">${escHtml(content)}</div>`
                : ''
            }
          </div>
        `);
      }

      const summaryParts = [
        ['emotion', '💗 情感与陪伴'],
        ['life', '🏡 生活与日常'],
        ['growth', '🌱 项目与成长'],
      ];

      for (const [key, label] of summaryParts) {
        if (sec[key]) {
          blocks.push(`
            <div class="card mt16">
              <div class="card-title">${label}</div>
              <div style="white-space:pre-wrap;line-height:1.8;margin-top:8px">
                ${escHtml(sec[key])}
              </div>
            </div>
          `);
        }
      }
    }

    const keywordHtml = keywords.length
      ? `
        <div class="card mt16">
          <div class="card-title">🏷️ 关键词</div>
          <div style="line-height:1.8;margin-top:8px">
            ${keywords.map((k) => escHtml(k)).join('　·　')}
          </div>
        </div>
      `
      : '';

    const diaryHtml = diary
      ? `
        <div class="card mt16">
          <div class="card-title">📝 AI 日记</div>
          <div style="white-space:pre-wrap;line-height:1.8;margin-top:8px">
            ${escHtml(diary)}
          </div>
        </div>
      `
      : '';

    const summaryHtml = summary
      ? `
        <div class="card mt16">
          <div class="card-title">✨ 概要</div>
          <div style="white-space:pre-wrap;line-height:1.8;margin-top:8px">
            ${escHtml(summary)}
          </div>
        </div>
      `
      : '';

    const modelHtml = page.model_used
      ? `
        <div class="text-sm muted mt16">
          生成模型：${escHtml(page.model_used)}
        </div>
      `
      : '';

    return `
      <div class="card">
        <div class="card-title">
          📅 ${escHtml(page.date || '')}
          ${title ? ` · ${escHtml(title)}` : ''}
        </div>

        <div class="card-desc">
          ${escHtml(typeLabel)}
        </div>
      </div>

      ${summaryHtml}
      ${blocks.join('')}
      ${diaryHtml}
      ${keywordHtml}
      ${modelHtml}
    `;
  },

  // ---- 生成整理 ----
  renderGenerate() {
    const today = todayStr(0);
    const yest = todayStr(-1);
    const completed = previousCompletePeriods(today);

    this.root.querySelector('#panel-generate').innerHTML = `
      <div class="banner banner-info">
        <span>⏳</span>
        <div>
          下面每个都是后台长任务（调用模型，可能需要几十秒）。
          点击后按钮会转圈，完成后弹出结果状态。
        </div>
      </div>

      <div class="card">
        <div class="card-title">📝 每日整理</div>
        <div class="card-desc">
          把某天的对话提取成记忆碎片与摘要（缺省＝昨天）。
        </div>
        <div class="toolbar mt8">
          <input type="date" id="d-daily" value="${escAttr(yest)}">
          <button class="btn btn-primary" data-act="gen-daily">
            运行每日整理
          </button>
        </div>
      </div>

      <div class="card mt16">
        <div class="card-title">📄 日页面生成</div>
        <div class="card-desc">
          为某一天生成结构化日页面（sections / keywords）。
        </div>
        <div class="toolbar mt8">
          <input type="date" id="d-day" value="${escAttr(yest)}">
          <button class="btn btn-primary" data-act="gen-day">
            生成日页面
          </button>
        </div>
      </div>

      <div class="card mt16">
        <div class="card-title">🗓️ 周总结</div>
        <div class="card-desc">
          汇总一周的日页面成周总结。
        </div>
        <div class="toolbar mt8">
          <label class="text-sm muted">起</label>
          <input
            type="date"
            id="d-week-start"
            value="${escAttr(completed.weekStart)}"
          >

          <label class="text-sm muted">止</label>
          <input
            type="date"
            id="d-week-end"
            value="${escAttr(completed.weekEnd)}"
          >

          <button class="btn btn-primary" data-act="gen-week">
            生成周总结
          </button>
        </div>
      </div>

      <div class="card mt16">
        <div class="card-title">📆 月总结</div>
        <div class="toolbar mt8">
          <input
            type="month"
            id="d-month"
            value="${escAttr(completed.month)}"
          >

          <button class="btn btn-primary" data-act="gen-month">
            生成月总结
          </button>
        </div>
      </div>

      <div class="grid grid-2 mt16">
        <div class="card">
          <div class="card-title">📊 季度总结</div>
          <div class="toolbar mt8">
            <input
              type="text"
              id="d-quarter"
              value="${escAttr(completed.quarter)}"
              placeholder="YYYY-QN"
              style="width:130px"
            >

            <button class="btn btn-primary" data-act="gen-quarter">
              生成季度
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">🎍 年度总结</div>
          <div class="toolbar mt8">
            <input
              type="number"
              id="d-year"
              value="${escAttr(completed.year)}"
              step="1"
              style="width:130px"
            >

            <button class="btn btn-primary" data-act="gen-year">
              生成年度
            </button>
          </div>
        </div>
      </div>
    `;
  },

  // ---- helpers ----
  val(id) {
    return this.root.querySelector('#' + id)?.value?.trim() || '';
  },

  dateQ(id) {
    const v = this.val(id);
    return v ? `?date=${encodeURIComponent(v)}` : '';
  },

  weekQ() {
    const s = this.val('d-week-start');
    const e = this.val('d-week-end');
    const parts = [];

    if (s) parts.push(`start=${encodeURIComponent(s)}`);
    if (e) parts.push(`end=${encodeURIComponent(e)}`);

    return parts.length ? '?' + parts.join('&') : '';
  },

  async runTask(btn, urlFn, label) {
    setBusy(btn, true, '整理中');

    try {
      const r = await get(urlFn());
      const status = r.status || 'ok';

      const extra = [
        r.date,
        r.month,
        r.week,
        r.label,
        r.page_id != null ? `页面#${r.page_id}` : '',
        r.fragments != null ? `碎片 ${r.fragments}` : '',
        r.digests != null ? `摘要 ${r.digests}` : '',
        r.sections != null ? `章节 ${r.sections}` : '',
      ]
        .filter(Boolean)
        .join(' · ');

      toast(
        `${label}：${status}${extra ? '（' + extra + '）' : ''}`,
        status === 'error' ? 'err' : 'ok'
      );
    } catch (e) {
      toast(`${label}失败：${e.message}`, 'err');
    } finally {
      setBusy(btn, false);
    }
  },
};
