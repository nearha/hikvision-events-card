import "./hikvision-events-card.js";

const Card = customElements.get("hikvision-events-card");

if (Card && !Card.__hikvisionHeightPatch) {
  Card.__hikvisionHeightPatch = true;

  const clampHeight = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return 520;
    return Math.max(160, Math.min(2000, num));
  };

  const applyHeight = (instance) => {
    const root = instance?.shadowRoot;
    if (!root || !instance._config) return;

    const events = root.querySelector(".events");
    if (!events) return;

    events.style.overflowY = "auto";
    events.style.overflowX = "hidden";
    events.style.overscrollBehavior = "contain";
    events.style.paddingRight = "4px";
    events.style.scrollbarWidth = "thin";

    const fixedHeight = clampHeight(instance._config.fixed_height);

    if (instance._config.auto_height === false) {
      events.style.maxHeight = `${fixedHeight}px`;
      events.style.height = `${fixedHeight}px`;
      return;
    }

    events.style.height = "auto";

    const rect = events.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
    const bottomGap = 24;
    const available = Math.max(180, Math.floor(viewportHeight - rect.top - bottomGap));

    events.style.maxHeight = `${available}px`;
  };

  const wrapAfterRender = (name) => {
    const original = Card.prototype[name];
    if (typeof original !== "function") return;

    Card.prototype[name] = function (...args) {
      const result = original.apply(this, args);
      applyHeight(this);
      return result;
    };
  };

  const originalGetStubConfig = Card.getStubConfig?.bind(Card);
  Card.getStubConfig = () => ({
    ...(originalGetStubConfig ? originalGetStubConfig() : {}),
    auto_height: true,
    fixed_height: 520,
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
          { name: "fixed_height", selector: { number: { min: 160, max: 2000, mode: "box", step: 10, unit_of_measurement: "px" } } }
        );
      }

      const originalComputeLabel = form.computeLabel;
      form.computeLabel = (schema) => {
        if (schema?.name === "auto_height") return "Altura automática";
        if (schema?.name === "fixed_height") return "Altura fixa";
        return originalComputeLabel?.(schema);
      };

      const originalComputeHelper = form.computeHelper;
      form.computeHelper = (schema) => {
        if (schema?.name === "auto_height") return "Ajusta a lista para caber na altura disponível da tela e ativa rolagem nos eventos.";
        if (schema?.name === "fixed_height") return "Altura em pixels usada quando a altura automática estiver desligada.";
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
        fixed_height: 520,
        ...(config || {}),
      });
    };
  }

  const originalConnectedCallback = Card.prototype.connectedCallback;
  Card.prototype.connectedCallback = function (...args) {
    const result = originalConnectedCallback?.apply(this, args);

    if (!this.__hikvisionHeightResize) {
      this.__hikvisionHeightResize = () => applyHeight(this);
    }

    window.addEventListener("resize", this.__hikvisionHeightResize);
    requestAnimationFrame(() => applyHeight(this));
    return result;
  };

  const originalDisconnectedCallback = Card.prototype.disconnectedCallback;
  Card.prototype.disconnectedCallback = function (...args) {
    if (this.__hikvisionHeightResize) {
      window.removeEventListener("resize", this.__hikvisionHeightResize);
    }

    return originalDisconnectedCallback?.apply(this, args);
  };

  wrapAfterRender("_render");
  wrapAfterRender("_renderDynamicContent");
  wrapAfterRender("_performUpdate");
}
