import "./hikvision-events-card.js";

const Card = customElements.get("hikvision-events-card");

if (Card && !Card.__hikvisionHeightPatchV2) {
  Card.__hikvisionHeightPatchV2 = true;

  const clampHeight = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return 620;
    return Math.max(260, Math.min(2200, num));
  };

  const px = (value) => {
    const num = Number.parseFloat(value);
    return Number.isNaN(num) ? 0 : num;
  };

  const resetLayout = (instance) => {
    const root = instance?.shadowRoot;
    if (!root) return;

    const card = root.querySelector("ha-card");
    const wrap = root.querySelector(".wrap");
    const content = root.querySelector("#content");
    const events = root.querySelector(".events");

    instance.style.maxHeight = "";
    instance.style.height = "";

    if (card) {
      card.style.height = "";
      card.style.maxHeight = "";
      card.style.overflow = "hidden";
    }

    if (wrap) {
      wrap.style.height = "";
      wrap.style.maxHeight = "";
      wrap.style.minHeight = "0";
      wrap.style.display = "";
      wrap.style.flexDirection = "";
      wrap.style.overflow = "";
      wrap.style.boxSizing = "border-box";
    }

    if (content) {
      content.style.height = "";
      content.style.maxHeight = "";
      content.style.minHeight = "0";
      content.style.overflow = "hidden";
    }

    if (events) {
      events.style.height = "";
      events.style.maxHeight = "";
      events.style.minHeight = "0";
      events.style.overflowY = "auto";
      events.style.overflowX = "hidden";
      events.style.overscrollBehavior = "contain";
      events.style.paddingRight = "4px";
      events.style.scrollbarWidth = "thin";
    }
  };

  const applyHeight = (instance) => {
    const root = instance?.shadowRoot;
    if (!root || !instance._config) return;

    const card = root.querySelector("ha-card");
    const wrap = root.querySelector(".wrap");
    const content = root.querySelector("#content");
    const events = root.querySelector(".events");

    if (!card || !wrap || !content) return;

    resetLayout(instance);

    const fixedHeight = clampHeight(instance._config.fixed_height);
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
    const bottomGap = 12;
    const cardTop = Math.max(0, card.getBoundingClientRect().top);

    const targetCardHeight = instance._config.auto_height === false
      ? fixedHeight
      : Math.max(260, Math.floor(viewportHeight - cardTop - bottomGap));

    instance.style.display = "block";
    instance.style.height = `${targetCardHeight}px`;
    instance.style.maxHeight = `${targetCardHeight}px`;

    card.style.height = `${targetCardHeight}px`;
    card.style.maxHeight = `${targetCardHeight}px`;
    card.style.overflow = "hidden";

    wrap.style.boxSizing = "border-box";
    wrap.style.height = "100%";
    wrap.style.maxHeight = "100%";
    wrap.style.minHeight = "0";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.overflow = "hidden";

    content.style.flex = "1 1 auto";
    content.style.minHeight = "0";
    content.style.height = "auto";
    content.style.maxHeight = "none";
    content.style.overflow = "hidden";

    if (events) {
      events.style.height = "100%";
      events.style.maxHeight = "100%";
      events.style.minHeight = "0";
      events.style.overflowY = "auto";
      events.style.overflowX = "hidden";
      events.style.overscrollBehavior = "contain";
      events.style.paddingRight = "4px";
      events.style.scrollbarWidth = "thin";
    } else {
      content.style.overflowY = "auto";
    }
  };

  const scheduleHeight = (instance) => {
    if (!instance || instance.__hikvisionHeightFrame) return;

    instance.__hikvisionHeightFrame = requestAnimationFrame(() => {
      instance.__hikvisionHeightFrame = null;
      applyHeight(instance);
      requestAnimationFrame(() => applyHeight(instance));
    });
  };

  const wrapAfterRender = (name) => {
    const original = Card.prototype[name];
    if (typeof original !== "function") return;

    Card.prototype[name] = function (...args) {
      const result = original.apply(this, args);
      scheduleHeight(this);
      return result;
    };
  };

  const originalGetCardSize = Card.prototype.getCardSize;
  Card.prototype.getCardSize = function (...args) {
    if (this?._config?.auto_height !== false) return 6;
    const fixedHeight = clampHeight(this?._config?.fixed_height);
    return Math.max(3, Math.ceil(fixedHeight / 50));
  };

  const originalGetStubConfig = Card.getStubConfig?.bind(Card);
  Card.getStubConfig = () => ({
    ...(originalGetStubConfig ? originalGetStubConfig() : {}),
    auto_height: true,
    fixed_height: 620,
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
          { name: "auto_height", selector: { boolean: {} } },
          { name: "fixed_height", selector: { number: { min: 260, max: 2200, mode: "box", step: 10, unit_of_measurement: "px" } } }
        );
      }

      const originalComputeLabel = form.computeLabel;
      form.computeLabel = (schema) => {
        if (schema?.name === "auto_height") return "Altura automática";
        if (schema?.name === "fixed_height") return "Altura fixa do card";
        return originalComputeLabel?.(schema);
      };

      const originalComputeHelper = form.computeHelper;
      form.computeHelper = (schema) => {
        if (schema?.name === "auto_height") return "Trava a altura total do card para caber na tela e deixa apenas a lista de eventos com rolagem.";
        if (schema?.name === "fixed_height") return "Altura total do card em pixels quando a altura automática estiver desligada.";
        return originalComputeHelper?.(schema);
      };

      return form;
    };
  }

  const originalSetConfig = Card.prototype.setConfig;
  if (typeof originalSetConfig === "function") {
    Card.prototype.setConfig = function (config) {
      return originalSetConfig.call(this, {
        auto_height: true,
        fixed_height: 620,
        ...(config || {}),
      });
    };
  }

  const originalConnectedCallback = Card.prototype.connectedCallback;
  Card.prototype.connectedCallback = function (...args) {
    const result = originalConnectedCallback?.apply(this, args);

    if (!this.__hikvisionHeightResize) {
      this.__hikvisionHeightResize = () => scheduleHeight(this);
    }

    window.addEventListener("resize", this.__hikvisionHeightResize);
    window.addEventListener("orientationchange", this.__hikvisionHeightResize);
    scheduleHeight(this);
    return result;
  };

  const originalDisconnectedCallback = Card.prototype.disconnectedCallback;
  Card.prototype.disconnectedCallback = function (...args) {
    if (this.__hikvisionHeightResize) {
      window.removeEventListener("resize", this.__hikvisionHeightResize);
      window.removeEventListener("orientationchange", this.__hikvisionHeightResize);
    }

    if (this.__hikvisionHeightFrame) {
      cancelAnimationFrame(this.__hikvisionHeightFrame);
      this.__hikvisionHeightFrame = null;
    }

    return originalDisconnectedCallback?.apply(this, args);
  };

  wrapAfterRender("_render");
  wrapAfterRender("_renderDynamicContent");
  wrapAfterRender("_performUpdate");
}
