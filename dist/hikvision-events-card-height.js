import "./hikvision-events-card.js";

const Card = customElements.get("hikvision-events-card");

if (Card && !Card.__hikvisionScrollWrapperPatch) {
  Card.__hikvisionScrollWrapperPatch = true;

  const DEFAULT_HEIGHT = "70vh";
  const DEFAULT_AUTO_HEIGHT = false;
  const DEFAULT_AUTO_MARGIN = 16;

  const normalizeHeight = (config) => {
    if (config?.height) return String(config.height);
    if (config?.fixed_height !== undefined && config?.fixed_height !== null && config?.fixed_height !== "") {
      const num = Number(config.fixed_height);
      if (!Number.isNaN(num)) return `${Math.max(180, Math.min(2000, num))}px`;
    }
    return DEFAULT_HEIGHT;
  };

  const applyScrollHeight = (instance) => {
    const root = instance?.shadowRoot;
    if (!root || !instance?._config) return;

    const scroller = root.querySelector(".events-scroll");
    const events = root.querySelector(".events-scroll > .events");
    if (!scroller || !events) return;

    scroller.style.overflowY = "auto";
    scroller.style.overflowX = "hidden";
    scroller.style.overscrollBehavior = "contain";
    scroller.style.scrollbarWidth = "thin";
    scroller.style.paddingRight = "4px";
    scroller.style.boxSizing = "border-box";

    events.style.height = "auto";
    events.style.maxHeight = "none";
    events.style.minHeight = "0";
    events.style.overflow = "visible";
    events.style.alignContent = "start";
    events.style.gridAutoRows = "max-content";

    root.querySelectorAll(".event-row").forEach((row) => {
      row.style.flexShrink = "0";
      row.style.minHeight = "";
      row.style.height = "auto";
    });

    if (instance._config.auto_height === true) {
      const rect = scroller.getBoundingClientRect();
      const margin = Number(instance._config.auto_height_margin ?? DEFAULT_AUTO_MARGIN);
      const available = Math.floor(window.innerHeight - rect.top - margin);
      scroller.style.height = `${Math.max(180, available)}px`;
      scroller.style.maxHeight = "none";
      return;
    }

    scroller.style.height = normalizeHeight(instance._config);
    scroller.style.maxHeight = "none";
  };

  const scheduleScrollHeight = (instance) => {
    if (!instance) return;
    clearTimeout(instance._hikvisionScrollHeightTimer);
    instance._hikvisionScrollHeightTimer = setTimeout(() => applyScrollHeight(instance), 60);
  };

  const wrapAfterRender = (name) => {
    const original = Card.prototype[name];
    if (typeof original !== "function") return;

    Card.prototype[name] = function (...args) {
      const result = original.apply(this, args);
      scheduleScrollHeight(this);
      return result;
    };
  };

  const originalContentHtml = Card.prototype._contentHtml;
  if (typeof originalContentHtml === "function") {
    Card.prototype._contentHtml = function (...args) {
      const html = originalContentHtml.apply(this, args);
      if (typeof html !== "string") return html;
      if (!html.includes('class="events"')) return html;
      if (html.includes('class="events-scroll"')) return html;
      return html.replace(
        /<div class="events">([\s\S]*)<\/div>\s*$/,
        '<div class="events-scroll"><div class="events">$1</div></div>'
      );
    };
  }

  const originalGetCardSize = Card.prototype.getCardSize;
  Card.prototype.getCardSize = function (...args) {
    return 8;
  };

  const originalGetStubConfig = Card.getStubConfig?.bind(Card);
  Card.getStubConfig = () => ({
    ...(originalGetStubConfig ? originalGetStubConfig() : {}),
    height: DEFAULT_HEIGHT,
    auto_height: DEFAULT_AUTO_HEIGHT,
    auto_height_margin: DEFAULT_AUTO_MARGIN,
  });

  const originalGetConfigForm = Card.getConfigForm?.bind(Card);
  if (originalGetConfigForm) {
    Card.getConfigForm = () => {
      const form = originalGetConfigForm();
      const options = form?.schema?.find((item) => item?.name === "options")?.schema;

      if (Array.isArray(options) && !options.some((item) => item?.name === "auto_height")) {
        const minimalIndex = options.findIndex((item) => item?.name === "minimal_mode");
        const insertAt = minimalIndex >= 0 ? minimalIndex + 1 : options.length;
        options.splice(
          insertAt,
          0,
          { name: "height", selector: { text: {} } },
          { name: "auto_height", selector: { boolean: {} } },
          { name: "auto_height_margin", selector: { number: { min: 0, max: 300, mode: "box", step: 1, unit_of_measurement: "px" } } }
        );
      }

      const originalComputeLabel = form.computeLabel;
      form.computeLabel = (schema) => {
        if (schema?.name === "height") return "Altura da lista";
        if (schema?.name === "auto_height") return "Altura automática";
        if (schema?.name === "auto_height_margin") return "Margem da altura automática";
        return originalComputeLabel?.(schema);
      };

      const originalComputeHelper = form.computeHelper;
      form.computeHelper = (schema) => {
        if (schema?.name === "height") return "Altura do bloco rolável de eventos quando a altura automática estiver desligada. Exemplo: 70vh, 520px, 40rem.";
        if (schema?.name === "auto_height") return "Calcula a altura do bloco rolável de eventos usando a tela disponível.";
        if (schema?.name === "auto_height_margin") return "Espaço em pixels para deixar livre no fim da tela no modo automático.";
        return originalComputeHelper?.(schema);
      };

      return form;
    };
  }

  const originalSetConfig = Card.prototype.setConfig;
  if (typeof originalSetConfig === "function") {
    Card.prototype.setConfig = function (config) {
      const next = {
        height: DEFAULT_HEIGHT,
        auto_height: DEFAULT_AUTO_HEIGHT,
        auto_height_margin: DEFAULT_AUTO_MARGIN,
        ...(config || {}),
      };

      if (next.fixed_height && !next.height) next.height = normalizeHeight(next);
      return originalSetConfig.call(this, next);
    };
  }

  const originalConnectedCallback = Card.prototype.connectedCallback;
  Card.prototype.connectedCallback = function (...args) {
    const result = originalConnectedCallback?.apply(this, args);

    if (!this._hikvisionScrollHeightOnResize) {
      this._hikvisionScrollHeightOnResize = () => scheduleScrollHeight(this);
    }

    window.addEventListener("focus", this._hikvisionScrollHeightOnResize);
    window.addEventListener("pageshow", this._hikvisionScrollHeightOnResize);
    window.addEventListener("resize", this._hikvisionScrollHeightOnResize);
    window.addEventListener("orientationchange", this._hikvisionScrollHeightOnResize);
    scheduleScrollHeight(this);
    return result;
  };

  const originalDisconnectedCallback = Card.prototype.disconnectedCallback;
  Card.prototype.disconnectedCallback = function (...args) {
    if (this._hikvisionScrollHeightOnResize) {
      window.removeEventListener("focus", this._hikvisionScrollHeightOnResize);
      window.removeEventListener("pageshow", this._hikvisionScrollHeightOnResize);
      window.removeEventListener("resize", this._hikvisionScrollHeightOnResize);
      window.removeEventListener("orientationchange", this._hikvisionScrollHeightOnResize);
    }

    clearTimeout(this._hikvisionScrollHeightTimer);
    return originalDisconnectedCallback?.apply(this, args);
  };

  wrapAfterRender("_render");
  wrapAfterRender("_renderDynamicContent");
  wrapAfterRender("_performUpdate");
}
