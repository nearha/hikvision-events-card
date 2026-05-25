# Hikvision Events Card

Card de dashboard para Home Assistant que mostra eventos Hikvision em uma lista única, com suporte a:

- eventos de Intercom / unlock;
- eventos ANPR / placas;
- busca;
- filtros por data;
- abas por origem;
- modo minimalista;
- imagens de detecção, veículo, placa e intercom.

## Repositório

```text
https://github.com/nearha/hikvision-events-card
```

O nome do repositório combina com o arquivo principal exigido pelo HACS:

```text
dist/hikvision-events-card.js
```

## Card type recomendado

Use este type nos dashboards novos:

```yaml
type: custom:hikvision-events-card
```

Compatibilidade mantida:

```yaml
type: custom:hikvision-unlock-events-card
```

O alias antigo continua registrado para não quebrar dashboards existentes, mas a entrada exibida no seletor visual do Home Assistant é apenas a nova.

## Instalação via HACS

1. No Home Assistant, abra **HACS**.
2. Vá em **Custom repositories**.
3. Adicione este repositório:
   ```text
   https://github.com/nearha/hikvision-events-card
   ```
4. Escolha a categoria **Dashboard**.
5. Instale **Hikvision Events Card**.
6. Faça refresh completo do navegador.

Depois da instalação via HACS, o recurso normalmente fica em:

```text
/hacsfiles/hikvision-events-card/hikvision-events-card.js
```

## Instalação manual

Copie o arquivo:

```text
dist/hikvision-events-card.js
```

para:

```text
/config/www/community/hikvision-events-card/hikvision-events-card.js
```

Depois adicione o recurso no Home Assistant:

```yaml
url: /local/community/hikvision-events-card/hikvision-events-card.js
type: module
```

## Exemplo YAML

```yaml
type: custom:hikvision-events-card
title: Eventos Hikvision
show_title: true
show_tabs: true
show_search: true
show_date_filters: true
minimal_mode: false
default_days: 7
max_items: 50
show_vehicle_image: true
show_detection_image: true
show_plate_image: true
intercom_device_ids:
  - DEVICE_ID_DO_INTERCOM
anpr_device_ids:
  - DEVICE_ID_DO_ANPR
```

## Configuração pela UI

O card fornece editor visual com seleção de devices:

- **Dispositivos Intercom**: selecione devices que tenham entidade `event` de unlock.
- **Dispositivos ANPR**: selecione devices ANPR com entidade `event` e/ou `image`.

## Migração do nome antigo

Instalação antiga provável:

```text
/config/www/community/hikvision-unlock-events-card/hikvision-unlock-events-card.js
```

Novo caminho recomendado:

```text
/config/www/community/hikvision-events-card/hikvision-events-card.js
```

Novo `type` recomendado:

```yaml
type: custom:hikvision-events-card
```

O antigo `custom:hikvision-unlock-events-card` ainda funciona como alias.

## Limpeza depois de migrar para HACS

Depois de confirmar que o card via HACS está funcionando:

1. Remova o recurso Lovelace antigo:
   ```text
   /local/community/hikvision-unlock-events-card/hikvision-unlock-events-card.js
   ```
2. Remova a pasta antiga:
   ```text
   /config/www/community/hikvision-unlock-events-card/
   ```
3. Mantenha apenas o recurso HACS:
   ```text
   /hacsfiles/hikvision-events-card/hikvision-events-card.js
   ```

Faça um refresh completo do navegador depois da limpeza.

## Desenvolvimento

Validação simples de sintaxe:

```bash
node --check dist/hikvision-events-card.js
```

## Estrutura

```text
.
├── dist/
│   └── hikvision-events-card.js
├── hacs.json
├── README.md
├── info.md
├── CHANGELOG.md
├── LICENSE
└── .github/
    └── workflows/
        └── validate.yml
```

## Licença

MIT.
