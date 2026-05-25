class HikvisionEventsCard extends HTMLElement {
  static getStubConfig() {
    return {
      title: "Eventos Hikvision",
      show_title: true,
      show_tabs: true,
      show_search: true,
      show_date_filters: true,
      minimal_mode: false,
      default_days: 7,
      max_items: 50,
      show_vehicle_image: true,
      show_detection_image: true,
      show_plate_image: true,
      intercom_device_ids: [],
      anpr_device_ids: [],
    };
  }

  static getConfigForm() {
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        {
          type: "grid",
          name: "devices",
          flatten: true,
          schema: [
            { name: "intercom_device_ids", selector: { device: { multiple: true, filter: [{ entity: { domain: "event" } }] } } },
            { name: "anpr_device_ids", selector: { device: { multiple: true, filter: [{ entity: { domain: "event" } }, { entity: { domain: "image" } }] } } },
          ],
        },
        {
          type: "grid",
          name: "options",
          flatten: true,
          schema: [
            { name: "show_title", selector: { boolean: {} } },
            { name: "show_tabs", selector: { boolean: {} } },
            { name: "show_search", selector: { boolean: {} } },
            { name: "show_date_filters", selector: { boolean: {} } },
            { name: "minimal_mode", selector: { boolean: {} } },
            { name: "default_days", selector: { number: { min: 1, max: 90, mode: "box", step: 1 } } },
            { name: "max_items", selector: { number: { min: 5, max: 500, mode: "box", step: 1 } } },
            { name: "show_vehicle_image", selector: { boolean: {} } },
            { name: "show_detection_image", selector: { boolean: {} } },
            { name: "show_plate_image", selector: { boolean: {} } },
          ],
        },
      ],
      computeLabel: (schema) => ({
        title: "Título",
        intercom_device_ids: "Dispositivos Intercom",
        anpr_device_ids: "Dispositivos ANPR",
        show_title: "Mostrar título",
        show_tabs: "Mostrar abas",
        show_search: "Mostrar busca",
        show_date_filters: "Mostrar filtros de data",
        minimal_mode: "Modo minimalista",
        default_days: "Dias iniciais",
        max_items: "Máximo de eventos",
        show_vehicle_image: "Mostrar imagem do veículo",
        show_detection_image: "Mostrar imagem de detecção",
        show_plate_image: "Mostrar crop da placa",
      }[schema.name]),
      computeHelper: (schema) => ({
        intercom_device_ids: "Selecione os devices do intercom que tenham a entidade event de unlock.",
        anpr_device_ids: "Selecione os devices ANPR.",
        show_date_filters: "Exibe ou oculta o período e os atalhos de data.",
        minimal_mode: "Mostra os eventos em formato leve, tipo log, mantendo o clique para abrir os detalhes.",
        default_days: "Quantidade de dias carregada ao abrir o card.",
        max_items: "Limite máximo de eventos exibidos.",
      }[schema.name]),
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._entities = null;
    this._items = [];
    this._selected = null;
    this._activeTab = "all";
    this._searchFilter = "";
    this._historyBusy = false;
    this._historyError = null;
    this._lastLiveSignature = "";
    this._refreshTimer = null;
    this._resolving = false;
    this._resolvedUrlCache = new Map();
    this._resolvePromiseCache = new Map();
    this._imageErrorCache = new Map();
    this._renderQueued = false;
    this._onEsc = (ev) => {
      if (ev.key === "Escape" && this._selected) {
        this._selected = null;
        this._render();
      }
    };
  }

  connectedCallback() {
    window.addEventListener("keydown", this._onEsc);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onEsc);
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
  }

  setConfig(config) {
    const intercom = Array.isArray(config.intercom_device_ids) ? config.intercom_device_ids.filter(Boolean) : [];
    const anpr = Array.isArray(config.anpr_device_ids) ? config.anpr_device_ids.filter(Boolean) : [];
    if (config.device_id && !intercom.includes(config.device_id)) intercom.push(config.device_id);

    this._config = {
      ...HikvisionEventsCard.getStubConfig(),
      ...config,
      intercom_device_ids: intercom,
      anpr_device_ids: anpr,
    };

    const range = this._defaultRange(this._config.default_days);
    this._startDate = range.start;
    this._endDate = range.end;
    this._entities = null;
    this._items = [];
    this._selected = null;
    this._historyError = null;
    this._lastLiveSignature = "";
    this._resolvedUrlCache.clear();
    this._resolvePromiseCache.clear();
    this._imageErrorCache.clear();
    this._render();
    this._ensureEntities();
  }

  set hass(hass) {
    this._hass = hass;
    this._ensureEntities();
    this._checkLiveRefresh();
    this._render();
  }

  getCardSize() {
    return 3 + Math.min(Math.max(this._items.length, 1), 8);
  }

  async _ensureEntities() {
    if (!this._hass || !this._config || this._entities || this._resolving) return;
    const ids = [...(this._config.intercom_device_ids || []), ...(this._config.anpr_device_ids || [])];
    if (!ids.length) return;

    this._resolving = true;
    try {
      const callWS = (msg) => this._hass.callWS ? this._hass.callWS(msg) : this._hass.connection.sendMessagePromise(msg);
      const [entities, devices] = await Promise.all([
        callWS({ type: "config/entity_registry/list" }),
        callWS({ type: "config/device_registry/list" }),
      ]);
      const deviceNames = new Map(devices.map((d) => [d.id, d.name_by_user || d.name || d.id]));
      const found = [];

      for (const deviceId of this._config.intercom_device_ids || []) {
        const entries = entities.filter((e) => e.device_id === deviceId && e.entity_id?.startsWith("event."));
        const event = entries.find((e) => this._token(`${e.unique_id || ""}${e.entity_id || ""}${e.name || ""}${e.original_name || ""}`).includes("unlock")) || entries[0];
        if (event) found.push({ source: "intercom", device_id: deviceId, entity_id: event.entity_id, device_name: this._cleanName(deviceNames.get(deviceId) || event.name || event.original_name || event.entity_id) });
      }

      for (const deviceId of this._config.anpr_device_ids || []) {
        const entries = entities.filter((e) => e.device_id === deviceId && e.entity_id?.startsWith("event."));
        const event = entries.find((e) => {
          const text = this._token(`${e.unique_id || ""}${e.entity_id || ""}${e.name || ""}${e.original_name || ""}`);
          return text.includes("anpr") || text.includes("lastevent") || text.includes("last");
        }) || entries[0];
        if (event) found.push({ source: "anpr", device_id: deviceId, entity_id: event.entity_id, device_name: this._cleanName(deviceNames.get(deviceId) || event.name || event.original_name || event.entity_id) });
      }

      this._entities = found;
      if (!found.length) this._historyError = "Não encontrei entidades event nos dispositivos configurados.";
      else await this._loadHistory();
    } catch (err) {
      this._historyError = err?.message || String(err);
    } finally {
      this._resolving = false;
      this._render();
    }
  }

  async _loadHistory() {
    if (!this._hass || !this._entities?.length || this._historyBusy) return;
    const start = this._startOfDay(this._startDate);
    const end = this._endOfDay(this._endDate);
    if (!start || !end || end < start) {
      this._historyError = "Filtro de data inválido.";
      this._render();
      return;
    }

    this._historyBusy = true;
    this._historyError = null;
    this._render();
    try {
      const ids = this._entities.map((e) => e.entity_id).join(",");
      const uri = `history/period/${encodeURIComponent(start.toISOString())}?filter_entity_id=${encodeURIComponent(ids)}&end_time=${encodeURIComponent(end.toISOString())}`;
      const response = await this._hass.callApi("GET", uri);
      const meta = new Map(this._entities.map((e) => [e.entity_id, e]));
      let items = [];

      for (const rows of Array.isArray(response) ? response : []) {
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          const m = meta.get(row.entity_id);
          if (!m) continue;
          const item = m.source === "intercom" ? this._parseIntercom(row, m) : this._parseAnpr(row, m);
          if (item.when && !this._isGhost(item)) items.push(item);
        }
      }

      items = this._dedupe(items).sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
      this._items = items.slice(0, Number(this._config.max_items || 50));
      this._preResolveImages(this._items.slice(0, 20));
    } catch (err) {
      this._items = [];
      this._historyError = err?.message || String(err);
    } finally {
      this._historyBusy = false;
      this._render();
    }
  }

  _parseIntercom(row, meta) {
    const a = row.attributes || {};
    return {
      source: "intercom",
      entity_id: row.entity_id,
      device_name: meta.device_name,
      when: a.event_time || a.occurred_at || a.event_timestamp || a.timestamp || row.last_changed || row.last_updated,
      unlock_type: a.unlock_type || row.state || "UNKNOWN",
      number: a.number ?? null,
      door_id: a.door_id ?? null,
      card_user_id: a.card_user_id ?? null,
      image_path: a.image_path || null,
      raw_state: row.state,
    };
  }

  _parseAnpr(row, meta) {
    const a = row.attributes || {};
    return {
      source: "anpr",
      entity_id: row.entity_id,
      device_name: meta.device_name,
      when: a.event_time || row.last_changed || row.last_updated || row.state,
      camera_event_time: a.event_time || "",
      plate: a.plate || "—",
      confidence: a.confidence || "—",
      direction: a.direction || "—",
      list_result: a.list_result || "—",
      country: a.country || "—",
      brand: a.brand || "—",
      type: a.type || "—",
      color: a.color || "—",
      detection_image_path: a.detection_image_path || null,
      license_plate_image_path: a.license_plate_image_path || null,
      vehicle_image_path: a.vehicle_image_path || null,
      raw_state: row.state,
    };
  }

  _checkLiveRefresh() {
    if (!this._hass || !this._entities?.length) return;
    const sig = this._entities.map((e) => {
      const s = this._hass.states[e.entity_id];
      return s ? `${e.entity_id}|${s.last_changed || ""}|${JSON.stringify(s.attributes || {})}` : e.entity_id;
    }).join("||");
    if (!sig || sig === this._lastLiveSignature) return;
    this._lastLiveSignature = sig;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this._loadHistory(), 1500);
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const items = this._filteredItems();
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block}ha-card{position:relative;overflow:hidden}.wrap{padding:16px}.header{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.title{font-size:20px;font-weight:700;line-height:1.2}.counter,.pill{border-radius:999px;background:var(--secondary-background-color);padding:6px 10px;font-size:12px}.toolbar{display:grid;gap:10px;margin-bottom:14px}.tabs,.dates,.quick,.search{display:flex;flex-wrap:wrap;gap:8px;align-items:end}button,input{box-sizing:border-box;font:inherit;min-height:38px;border-radius:10px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);padding:0 12px}button{cursor:pointer}.primary{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:var(--primary-color)}.active{border-color:var(--primary-color);color:var(--primary-color);background:color-mix(in srgb,var(--primary-color) 10%,transparent)}label{display:grid;gap:4px;color:var(--secondary-text-color);font-size:12px}.search input{min-width:240px}.events{display:grid;gap:10px}.row{width:100%;text-align:left;padding:10px;border:1px solid var(--divider-color);border-radius:14px;background:var(--card-background-color);display:grid;grid-template-columns:116px 1fr;gap:12px;align-items:stretch}.minimal{display:flex;grid-template-columns:none;min-height:64px}.thumb{width:100%;height:88px;min-height:88px;object-fit:cover;border-radius:10px;background:#00000012;display:block}.thumb.placeholder{display:flex;align-items:center;justify-content:center;color:var(--secondary-text-color);font-size:12px;text-transform:uppercase}.main{min-width:0;display:grid;gap:6px;align-content:center}.headline{font-size:22px;font-weight:800;line-height:1.2}.sub,.meta{color:var(--secondary-text-color);font-size:13px}.badges{display:flex;gap:6px;flex-wrap:wrap}.pill{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--divider-color);min-height:24px;padding:0 8px;font-weight:600;color:var(--primary-text-color)}.message{padding:14px;border-radius:12px;background:var(--secondary-background-color);color:var(--secondary-text-color)}.error{color:var(--error-color)}.overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:999}.modal{width:min(1100px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;border-radius:18px;background:var(--card-background-color);color:var(--primary-text-color);padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.35)}.modal-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.modal-title{font-size:28px;font-weight:800;line-height:1.1}.grid{display:grid;grid-template-columns:300px 1fr;gap:16px;margin-top:14px}.details,.image-card{border:1px solid var(--divider-color);border-radius:14px;background:var(--card-background-color)}.details{padding:8px;align-self:start}.drow{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--divider-color);font-size:14px}.drow:last-child{border-bottom:0}.drow span{color:var(--secondary-text-color)}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.image-card div{font-weight:700;padding:10px 12px;border-bottom:1px solid var(--divider-color)}.image-card img{width:100%;height:auto;display:block;background:#00000012}.image-card .missing{min-height:180px;display:flex;align-items:center;justify-content:center;color:var(--secondary-text-color);padding:16px}@media(max-width:800px){.row{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.modal-title{font-size:22px}}
      </style>
      <ha-card><div class="wrap">
        ${this._config.show_title === false ? "" : `<div class="header"><div class="title">${this._esc(this._config.title || "Eventos Hikvision")}</div><div class="counter">${items.length} evento(s)</div></div>`}
        <div class="toolbar">
          ${this._tabsHtml()}
          ${this._config.show_date_filters ? `<div class="dates"><label><span>De</span><input id="start" type="date" value="${this._esc(this._startDate)}"></label><label><span>Até</span><input id="end" type="date" value="${this._esc(this._endDate)}"></label><button class="primary" id="filter">Filtrar</button></div><div class="quick"><button data-days="1">Hoje</button><button data-days="7">7 dias</button><button data-days="30">30 dias</button></div>` : ""}
          ${this._config.show_search ? `<div class="search"><input id="search" type="search" placeholder="Buscar evento..." value="${this._esc(this._searchFilter)}"></div>` : ""}
        </div>
        <div>${this._contentHtml(items)}</div>
      </div></ha-card>
      ${this._modalHtml()}
    `;
    this._bind();
  }

  _contentHtml(items) {
    if (!this._hass) return `<div class="message">Aguardando Home Assistant…</div>`;
    if (!this._hasConfig()) return `<div class="message">Configure os dispositivos do Intercom, do ANPR, ou ambos.</div>`;
    if (this._historyError) return `<div class="message error">${this._esc(this._historyError)}</div>`;
    if (!this._entities?.length) return `<div class="message">Localizando entidades de evento…</div>`;
    if (this._historyBusy && !this._items.length) return `<div class="message">Carregando eventos…</div>`;
    if (!items.length) return `<div class="message">Nenhum evento encontrado no período selecionado.</div>`;
    return `<div class="events">${items.map((i) => this._rowHtml(i)).join("")}</div>`;
  }

  _rowHtml(item) {
    const title = item.source === "intercom" ? this._displayName(item) : this._text(item.plate);
    const sub = `${this._text(item.device_name)} • ${this._formatDate(item.when)}`;
    const thumb = this._config.minimal_mode ? "" : this._renderRowImage(this._primaryImage(item), title);
    const badges = item.source === "intercom"
      ? `<span class="pill">${this._esc(this._unlockLabel(item.unlock_type))}</span>${this._hasValue(item.door_id) ? `<span class="pill">Porta ${this._esc(item.door_id)}</span>` : ""}`
      : `<span class="pill">${this._esc(this._listLabel(item.list_result))}</span><span class="pill">${this._esc(this._direction(item.direction))}</span><span class="pill">${this._esc(this._confidence(item.confidence))}</span>`;
    const meta = item.source === "intercom"
      ? `Nome: ${this._esc(title)}${this._hasValue(item.card_user_id) ? ` • Card User ID: ${this._esc(item.card_user_id)}` : ""}`
      : `Marca: ${this._esc(this._text(item.brand))} • Tipo: ${this._esc(this._vehicleType(item.type))} • Cor: ${this._esc(this._colorLabel(item.color))}`;
    return `<button class="row ${this._config.minimal_mode ? "minimal" : ""}" data-key="${this._esc(this._key(item))}">${thumb}<div class="main"><div class="headline">${this._esc(title)}</div><div class="sub">${this._esc(sub)}</div><div class="badges">${badges}</div><div class="meta">${meta}</div></div></button>`;
  }

  _modalHtml() {
    const item = this._selected;
    if (!item) return "";
    const title = item.source === "intercom" ? this._displayName(item) : this._text(item.plate);
    const details = item.source === "intercom" ? [
      ["Tipo", this._unlockLabel(item.unlock_type)], ["Exibição", title], ["Device", item.device_name], ["Porta", item.door_id], ["Data", this._formatDate(item.when)], ["Card User ID", item.card_user_id]
    ] : [
      ["Marca", item.brand], ["Tipo", this._vehicleType(item.type)], ["Cor", this._colorLabel(item.color)], ["País", item.country], ["Direção", this._direction(item.direction)], ["Confidence", this._confidence(item.confidence)]
    ];
    const images = this._imagesFor(item).map(([name, path]) => this._renderDetailImage(name, path)).join("");
    return `<div class="overlay" id="overlay"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="modal-title">${this._esc(title)}</div><div class="sub">${this._esc(this._text(item.device_name))} • ${this._esc(this._formatDate(item.when))}</div></div><button id="close" aria-label="Fechar">✕</button></div><div class="grid"><div class="details">${details.map(([k,v]) => `<div class="drow"><span>${this._esc(k)}</span><strong>${this._esc(this._text(v))}</strong></div>`).join("")}</div><div class="images">${images}</div></div></div></div>`;
  }

  _bind() {
    this.shadowRoot.querySelectorAll("[data-key]").forEach((el) => el.onclick = () => {
      this._selected = this._items.find((i) => this._key(i) === el.dataset.key) || null;
      this._render();
    });
    this.shadowRoot.querySelectorAll("[data-tab]").forEach((el) => el.onclick = () => {
      this._activeTab = el.dataset.tab || "all";
      this._render();
    });
    const filter = this.shadowRoot.getElementById("filter");
    if (filter) filter.onclick = () => {
      this._startDate = this.shadowRoot.getElementById("start")?.value || this._startDate;
      this._endDate = this.shadowRoot.getElementById("end")?.value || this._endDate;
      this._loadHistory();
    };
    this.shadowRoot.querySelectorAll("[data-days]").forEach((el) => el.onclick = () => {
      const r = this._defaultRange(Number(el.dataset.days));
      this._startDate = r.start;
      this._endDate = r.end;
      this._loadHistory();
    });
    const search = this.shadowRoot.getElementById("search");
    if (search) search.oninput = (ev) => { this._searchFilter = ev.target.value || ""; this._render(); };
    const close = this.shadowRoot.getElementById("close");
    if (close) close.onclick = () => { this._selected = null; this._render(); };
    const overlay = this.shadowRoot.getElementById("overlay");
    if (overlay) overlay.onclick = (ev) => { if (ev.target === overlay) { this._selected = null; this._render(); } };
  }

  _tabsHtml() {
    if (!(this._config.show_tabs && this._config.intercom_device_ids?.length && this._config.anpr_device_ids?.length)) {
      this._activeTab = "all";
      return "";
    }
    return `<div class="tabs">${[["all","Todos"],["intercom","Intercom"],["anpr","ANPR"]].map(([k,l]) => `<button class="${this._activeTab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>`;
  }

  _filteredItems() {
    let items = this._items || [];
    if (this._activeTab !== "all") items = items.filter((i) => i.source === this._activeTab);
    const q = this._searchFilter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => this._searchText(i).includes(q));
  }

  _searchText(item) {
    return [
      item.source, item.entity_id, item.device_name, item.when, item.unlock_type, item.number,
      item.door_id, item.card_user_id, item.plate, item.confidence, item.direction, item.list_result,
      item.country, item.brand, item.type, item.color, this._formatDate(item.when)
    ].map((x) => this._text(x, "")).join(" ").toLowerCase();
  }

  _normalizePath(path) {
    return String(path || "").replaceAll("\\", "/").trim();
  }

  _pathToDirectUrl(path) {
    const p = this._normalizePath(path);
    if (!p) return null;
    if (/^(https?:|data:|blob:|\/local\/)/.test(p)) return p;
    if (p.startsWith("/config/www/")) return `/local/${encodeURI(p.slice("/config/www/".length))}`;
    return null;
  }

  _pathToMediaSourceId(path) {
    const p = this._normalizePath(path);
    if (!p) return null;
    if (p.startsWith("media-source://")) return p;
    if (p.startsWith("/media/")) return `media-source://media_source/local/${p.slice("/media/".length)}`;
    return null;
  }

  async _resolveMediaPath(path) {
    const p = this._normalizePath(path);
    if (!p || !this._hass) return null;
    const direct = this._pathToDirectUrl(p);
    if (direct) return direct;
    const mediaContentId = this._pathToMediaSourceId(p);
    if (!mediaContentId) throw new Error("unsupported_path");
    const response = await this._hass.callWS({
      type: "media_source/resolve_media",
      media_content_id: mediaContentId,
      expires: 3600,
    });
    return response?.url || null;
  }

  _preResolveImages(items) {
    for (const item of items) {
      for (const [, path] of this._imagesFor(item)) this._ensureResolvedImage(path);
    }
  }

  _ensureResolvedImage(path) {
    const p = this._normalizePath(path);
    if (!p || this._resolvedUrlCache.has(p) || this._resolvePromiseCache.has(p)) return;
    const direct = this._pathToDirectUrl(p);
    if (direct) {
      this._resolvedUrlCache.set(p, direct);
      return;
    }
    const promise = this._resolveMediaPath(p)
      .then((url) => {
        if (!url) throw new Error("empty_resolved_url");
        this._resolvedUrlCache.set(p, url);
        this._imageErrorCache.delete(p);
        this._queueRender();
        return url;
      })
      .catch((err) => {
        this._imageErrorCache.set(p, err?.message || String(err));
        this._queueRender();
        return null;
      })
      .finally(() => this._resolvePromiseCache.delete(p));
    this._resolvePromiseCache.set(p, promise);
  }

  _getImageState(path) {
    const p = this._normalizePath(path);
    if (!p) return { kind: "missing", src: null };
    const direct = this._pathToDirectUrl(p);
    if (direct) return { kind: "ready", src: direct };
    const cached = this._resolvedUrlCache.get(p);
    if (cached) return { kind: "ready", src: cached };
    const err = this._imageErrorCache.get(p);
    if (err) return { kind: "error", src: null, error: err };
    this._ensureResolvedImage(p);
    return { kind: "loading", src: null };
  }

  _renderRowImage(path, alt) {
    const state = this._getImageState(path);
    if (state.kind === "ready" && state.src) return `<img class="thumb" src="${this._esc(state.src)}" alt="${this._esc(alt)}" loading="lazy">`;
    if (state.kind === "loading") return `<div class="thumb placeholder">carregando…</div>`;
    if (state.kind === "error") return `<div class="thumb placeholder">erro imagem</div>`;
    return `<div class="thumb placeholder">sem imagem</div>`;
  }

  _renderDetailImage(title, path) {
    const state = this._getImageState(path);
    const head = `<div>${this._esc(title)}</div>`;
    if (state.kind === "ready" && state.src) return `<div class="image-card">${head}<img src="${this._esc(state.src)}" alt="${this._esc(title)}"></div>`;
    if (state.kind === "loading") return `<div class="image-card">${head}<div class="missing">Carregando imagem…</div></div>`;
    if (state.kind === "error") return `<div class="image-card">${head}<div class="missing">Erro ao carregar imagem</div></div>`;
    return `<div class="image-card">${head}<div class="missing">Imagem não disponível</div></div>`;
  }

  _queueRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      this._render();
    });
  }

  _imagesFor(item) {
    if (item.source === "intercom") return [["Imagem", item.image_path]];
    const out = [];
    if (this._config.show_detection_image) out.push(["Detecção", item.detection_image_path]);
    if (this._config.show_plate_image) out.push(["Placa", item.license_plate_image_path]);
    if (this._config.show_vehicle_image) out.push(["Veículo", item.vehicle_image_path]);
    if (!out.length) {
      if (item.detection_image_path) out.push(["Detecção", item.detection_image_path]);
      if (item.license_plate_image_path) out.push(["Placa", item.license_plate_image_path]);
      if (item.vehicle_image_path) out.push(["Veículo", item.vehicle_image_path]);
    }
    return out;
  }

  _primaryImage(item) {
    return this._imagesFor(item).map((x) => x[1]).find((p) => this._hasValue(p));
  }

  _hasConfig() { return Boolean(this._config?.intercom_device_ids?.length || this._config?.anpr_device_ids?.length); }
  _defaultRange(days) { const end = new Date(); const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - Math.max((Number(days) || 1) - 1, 0)); return { start: this._dateInput(start), end: this._dateInput(end) }; }
  _dateInput(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  _startOfDay(v) { const d = new Date(`${v}T00:00:00`); return Number.isNaN(d.getTime()) ? null : d; }
  _endOfDay(v) { const d = new Date(`${v}T23:59:59.999`); return Number.isNaN(d.getTime()) ? null : d; }
  _formatDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? this._text(v) : new Intl.DateTimeFormat(this._hass?.locale?.language || "pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(d); }
  _token(v) { return String(v || "").toLowerCase().replace(/[_\-\s]/g, ""); }
  _hasValue(v) { return this._text(v, "") !== ""; }
  _text(v, fallback = "—") { if (v === undefined || v === null) return fallback; const s = String(v).trim(); return !s || ["unknown", "unkown", "unknown_state", "unavailable", "none", "null", "0", "—", "not supported by the algorithm"].includes(s.toLowerCase()) ? fallback : s; }
  _cleanName(v) { return this._text(v, "Device").replace(/\s+(Unlock|Ring|Call|ANPR)$/i, ""); }
  _esc(v) { return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  _unlockType(v) { return String(v || "UNKNOWN").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_"); }
  _unlockLabel(v) { return { FACE: "Facial", FINGERPRINT: "Digital", CARD: "Cartão", QR: "QR", QR_CODE: "QR", PASSWORD: "Senha", HOUSEHOLDER: "Interfone", CENTER_PLATFORM: "Central" }[this._unlockType(v)] || "Desconhecido"; }
  _displayName(item) { const n = this._text(item.number, ""); const t = this._unlockType(item.unlock_type); if (t === "HOUSEHOLDER") return n ? `Tela ${n}` : "Tela"; if (t === "CENTER_PLATFORM") return "Central"; return n || this._unlockLabel(t); }
  _direction(v) { const t = this._token(v); if (["in", "entry", "enter", "forward"].some((x) => t.includes(x))) return "Entrando"; if (["out", "exit", "reverse"].some((x) => t.includes(x))) return "Saindo"; return this._text(v); }
  _listLabel(v) { const t = this._token(v); if (t.includes("allow") || t.includes("whitelist")) return "Registrado"; if (t.includes("black") || t.includes("block")) return "Bloqueado"; if (t.includes("other")) return "Outro"; return this._text(v); }
  _confidence(v) { const n = Number(v); if (!Number.isNaN(n)) return `${Math.round(n <= 1 ? n * 100 : n)}%`; return this._text(v); }
  _vehicleType(v) { const t = this._token(v); return { sedan: "Sedan", saloon: "Sedan", hatchback: "Hatch", suv: "SUV", mpv: "MPV", van: "Van", minivan: "Minivan", truck: "Caminhão", pickup: "Picape", pickuptruck: "Picape", bus: "Ônibus", motorcycle: "Moto", motorbike: "Moto", bike: "Moto", coupe: "Cupê", wagon: "Perua", estate: "Perua", convertible: "Conversível", cabrio: "Conversível", vehicle: "Veículo", unknown: "Desconhecido", unkown: "Desconhecido", other: "Outro" }[t] || this._text(v); }
  _colorLabel(v) { const t = this._token(v); return { black: "Preto", white: "Branco", gray: "Cinza", grey: "Cinza", silver: "Prata", blue: "Azul", red: "Vermelho", green: "Verde", yellow: "Amarelo", orange: "Laranja", brown: "Marrom", purple: "Roxo", violet: "Violeta", beige: "Bege", gold: "Dourado", pink: "Rosa", cyan: "Ciano", unknown: "Desconhecido", unkown: "Desconhecido", other: "Outro" }[t] || this._text(v); }
  _key(i) { return [i.source, i.entity_id, i.when, i.plate, i.unlock_type, i.number, i.door_id, i.image_path, i.detection_image_path, i.license_plate_image_path, i.vehicle_image_path].map((x) => x || "").join("|"); }
  _dedupe(items) { const seen = new Set(); return items.filter((i) => { const k = this._key(i); if (seen.has(k)) return false; seen.add(k); return true; }); }
  _isGhost(item) {
    if (item.source === "intercom") return !item.when || ["unknown", "unavailable", "none"].includes(String(item.raw_state || "").trim().toLowerCase());
    return !this._primaryImage(item) && [item.camera_event_time, item.plate, item.direction, item.list_result, item.country, item.brand, item.type, item.color, item.confidence].every((x) => !this._hasValue(x));
  }
}

class HikvisionUnlockEventsCardAlias extends HikvisionEventsCard {}

if (!customElements.get("hikvision-events-card")) customElements.define("hikvision-events-card", HikvisionEventsCard);
if (!customElements.get("hikvision-unlock-events-card")) customElements.define("hikvision-unlock-events-card", HikvisionUnlockEventsCardAlias);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "hikvision-events-card")) {
  window.customCards.push({
    type: "hikvision-events-card",
    name: "Hikvision Events Card",
    description: "Card unificado para eventos Intercom e ANPR da Hikvision",
    preview: true,
  });
}
