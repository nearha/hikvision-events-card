import "./hikvision-events-card.js";

const Card = customElements.get("hikvision-events-card");

if (Card && !Card.__hikvisionSafeScrollPatch) {
  Card.__hikvisionSafeScrollPatch = true;

  const DEFAULT_HEIGHT = "70vh";
  const DEFAULT_AUTO_HEIGHT = true;
  const DEFAULT_AUTO_HEIGHT_MARGIN = 16;

  const normalizeHeight = (config) => {
    if (config?.height) return String(config.height);

    const fixed = Number(config?.fixed_height);
    if (!Number.isNaN(fixed) && fixed > 0) {
      return `${Math.max(180, Math.min(2000, fixed))}px`;
    }

    return DEFAULT_HEIGHT;
  };

  const getScroller = (instance) => {
    const root = instance?.shadowRoot;
    if (!root) return null;

    let scroller = root.querySelector(".events-scroll");
    if (scroller) return scroller;

    const content = root.getElementById("content");
    const events = content?.querySelector(":scope > .events") || root.querySelector(".events");
    if (!content || !events || events.parentElement?.classList?.contains("events-scroll")) {
      return events?.parentElement?.classList?.contains("events-scroll") ? events.parentElement : null;
    }

    scroller = document.createElement("div");
    scroller.className = "events-scroll";
    events.parentNode.insertBefore(scroller, events);
    scroller.appendChild(events);
    return scroller;
  };

  const applyScrollHeight = (instance) => {
    const scroller = getScroller(instance);
    if (!scroller || !instance?._config) return;

    const events = scroller.querySelector(".events");

    scroller.style.overflowY = "auto";
    scroller.style.overflowX = "hidden";
    scroller.style.overscrollBehavior = "contain";
    scroller.style.boxSizing = "border-box";
    scroller.style.paddingRight = "4px";
    scroller.style.scrollbarWidth = "thin";

    if (events) {
      events.style.height = "auto";
      events.style.maxHeight = "none";
      events.style.minHeight = "0";
      events.style.overflow = "visible";
      events.style.alignContent = "start";
      events.style.gridAutoRows = "max-content";
    }

    scroller.querySelectorAll(".event-row").forEach((row) => {
      row.style.height = "auto";
      row.style.minHeight = "";
      row.style.flexShrink = "0";
    });

    if (instance._config.auto_height !== false) {
      const rect = scroller.getBoundingClientRect();
      const margin = Number(instance._config.auto_height_margin ?? DEFAULT_AUTO_HEIGHT_MARGIN);
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
    clearTimeout(instance.__hikvisionSafeScrollTimer);
    instance.__hikvisionSafeScrollTimer = setTimeout(() => applyScrollHeight(instance), 60);
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

  Card.prototype.getCardSize = function () {
    return 8;
  };

  const originalGetStubConfig = Card.getStubConfig?.bind(Card);
  Card.getStubConfig = () => ({
    ...(originalGetStubConfig ? originalGetStubConfig() : {}),
    height: DEFAULT_HEIGHT,
    auto_height: DEFAULT_AUTO_HEIGHT,
    auto_height_margin: DEFAULT_AUTO_HEIGHT_MARGIN,
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
        if (schema?.name === "auto_height_margin") return "Margem inferior";
        return originalComputeLabel?.(schema);
      };

      const originalComputeHelper = form.computeHelper;
      form.computeHelper = (schema) => {
        if (schema?.name === "height") return "Altura do bloco rolável quando a altura automática estiver desligada. Exemplo: 70vh, 520px, 40rem.";
        if (schema?.name === "auto_height") return "Calcula a altura do bloco rolável usando a tela disponível, igual ao Blue Iris card.";
        if (schema?.name === "auto_height_margin") return "Espaço livre em pixels no fim da tela quando a altura automática estiver ligada.";
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
        auto_height_margin: DEFAULT_AUTO_HEIGHT_MARGIN,
        ...(config || {}),
      };

      if (next.fixed_height && !next.height) next.height = normalizeHeight(next);
      return originalSetConfig.call(this, next);
    };
  }

  const originalConnectedCallback = Card.prototype.connectedCallback;
  Card.prototype.connectedCallback = function (...args) {
    const result = originalConnectedCallback?.apply(this, args);

    if (!this.__hikvisionSafeScrollResize) {
      this.__hikvisionSafeScrollResize = () => scheduleScrollHeight(this);
    }

    window.addEventListener("focus", this.__hikvisionSafeScrollResize);
    window.addEventListener("pageshow", this.__hikvisionSafeScrollResize);
    window.addEventListener("resize", this.__hikvisionSafeScrollResize);
    window.addEventListener("orientationchange", this.__hikvisionSafeScrollResize);
    scheduleScrollHeight(this);
    return result;
  };

  const originalDisconnectedCallback = Card.prototype.disconnectedCallback;
  Card.prototype.disconnectedCallback = function (...args) {
    if (this.__hikvisionSafeScrollResize) {
      window.removeEventListener("focus", this.__hikvisionSafeScrollResize);
      window.removeEventListener("pageshow", this.__hikvisionSafeScrollResize);
      window.removeEventListener("resize", this.__hikvisionSafeScrollResize);
      window.removeEventListener("orientationchange", this.__hikvisionSafeScrollResize);
    }

    clearTimeout(this.__hikvisionSafeScrollTimer);
    return originalDisconnectedCallback?.apply(this, args);
  };

  wrapAfterRender("_render");
  wrapAfterRender("_renderDynamicContent");
  wrapAfterRender("_performUpdate");
}
