import "./hikvision-events-card.js";

const Card = customElements.get("hikvision-events-card");

if (Card && !Card.__hikvisionBlueIrisHeightPatch) {
  Card.__hikvisionBlueIrisHeightPatch = true;

  const toFixedHeight = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return "70vh";
    return `${Math.max(180, Math.min(2000, num))}px`;
  };

  const configuredHeight = (config) => {
    if (config?.height) return String(config.height);
    if (config?.fixed_height) return toFixedHeight(config.fixed_height);
    return "70vh";
  };

  const applyListHeight = (instance) => {
    const list = instance?.shadowRoot?.querySelector(".events");
    if (!list || !instance?._config) return;

    list.style.overflowY = "auto";
    list.style.overflowX = "hidden";
    list.style.overscrollBehavior = "contain";
    list.style.scrollbarWidth = "thin";
    list.style.paddingRight = "4px";

    if (instance._config.auto_height === true) {
      const rect = list.getBoundingClientRect();
      const margin = Number(instance._config.auto_height_margin ?? 16);
      const available = Math.floor(window.innerHeight - rect.top - margin);
      const minHeight = 180;
      list.style.height = `${Math.max(minHeight, available)}px`;
      list.style.maxHeight = "none";
      return;
    }

    list.style.height = configuredHeight(instance._config);
    list.style.maxHeight = "none";
  };

  const scheduleListHeight = (instance) => {
    if (!instance) return;
    clearTimeout(instance._heightTimer);
    instance._heightTimer = setTimeout(() => applyListHeight(instance), 60);
  };

  const wrapAfterRender = (name) => {
    const original = Card.prototype[name];
    if (typeof original !== "function") return;

    Card.prototype[name] = function (...args) {
      const result = original.apply(this, args);
      scheduleListHeight(this);
      return result;
    };
  };

  Card.prototype.getCardSize = function () {
    return 8;
  };

  const originalGetStubConfig = Card.getStubConfig?.bind(Card);
  Card.getStubConfig = () => ({
    ...(originalGetStubConfig ? originalGetStubConfig() : {}),
    height: "70vh",
    auto_height: false,
    auto_height_margin: 16,
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
        if (schema?.name === "height") return "Altura";
        if (schema?.name === "auto_height") return "Altura automática";
        if (schema?.name === "auto_height_margin") return "Margem da altura automática";
        return originalComputeLabel?.(schema);
      };

      const originalComputeHelper = form.computeHelper;
      form.computeHelper = (schema) => {
        if (schema?.name === "height") return "Altura da lista quando a altura automática estiver desligada. Exemplo: 70vh, 520px, 40rem.";
        if (schema?.name === "auto_height") return "Igual ao Blue Iris: calcula a altura da lista usando a tela disponível.";
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
        height: "70vh",
        auto_height: false,
        auto_height_margin: 16,
        ...(config || {}),
      };

      if (next.fixed_height && !next.height) next.height = toFixedHeight(next.fixed_height);
      return originalSetConfig.call(this, next);
    };
  }

  const originalConnectedCallback = Card.prototype.connectedCallback;
  Card.prototype.connectedCallback = function (...args) {
    const result = originalConnectedCallback?.apply(this, args);

    if (!this._hikvisionHeightOnResize) {
      this._hikvisionHeightOnResize = () => scheduleListHeight(this);
    }

    window.addEventListener("focus", this._hikvisionHeightOnResize);
    window.addEventListener("pageshow", this._hikvisionHeightOnResize);
    window.addEventListener("resize", this._hikvisionHeightOnResize);
    window.addEventListener("orientationchange", this._hikvisionHeightOnResize);
    scheduleListHeight(this);
    return result;
  };

  const originalDisconnectedCallback = Card.prototype.disconnectedCallback;
  Card.prototype.disconnectedCallback = function (...args) {
    if (this._hikvisionHeightOnResize) {
      window.removeEventListener("focus", this._hikvisionHeightOnResize);
      window.removeEventListener("pageshow", this._hikvisionHeightOnResize);
      window.removeEventListener("resize", this._hikvisionHeightOnResize);
      window.removeEventListener("orientationchange", this._hikvisionHeightOnResize);
    }

    clearTimeout(this._heightTimer);
    return originalDisconnectedCallback?.apply(this, args);
  };

  wrapAfterRender("_render");
  wrapAfterRender("_renderDynamicContent");
  wrapAfterRender("_performUpdate");
}
