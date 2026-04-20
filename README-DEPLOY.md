# Tomaso Pignocchi — package aggiornato

Questo pacchetto mantiene l'estetica del sito e introduce queste modifiche strutturali:

- niente configurazioni salvate nel browser per il sito pubblico
- impostazioni visive salvate in Contentful (`siteSettings`)
- admin senza password client-side
- scritture admin tramite Worker Cloudflare protetto con Zero Trust / Access

## 1) Configura il sito pubblico

Apri `js/site-config.js` e sostituisci:

- `REPLACE_WITH_CONTENTFUL_SPACE_ID`
- `REPLACE_WITH_CONTENTFUL_DELIVERY_TOKEN`

Se usi un environment diverso da `master`, modifica anche `environment`.

## 2) Deploy del Worker Cloudflare

File inclusi:

- `cloudflare/admin-worker.js`
- `cloudflare/wrangler.toml`

Imposta questi secret nel Worker:

- `CONTENTFUL_SPACE_ID`
- `CONTENTFUL_ENVIRONMENT`
- `CONTENTFUL_LOCALE`
- `CONTENTFUL_MANAGEMENT_TOKEN`
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_AUD`

Esempio:

```bash
wrangler secret put CONTENTFUL_SPACE_ID
wrangler secret put CONTENTFUL_ENVIRONMENT
wrangler secret put CONTENTFUL_LOCALE
wrangler secret put CONTENTFUL_MANAGEMENT_TOKEN
wrangler secret put ACCESS_TEAM_DOMAIN
wrangler secret put ACCESS_AUD
```

Poi pubblica il Worker con una route su:

- `/api/admin/*`

## 3) Proteggi l'admin con Cloudflare Access

Crea una Access application per:

- `/admin/*`
- `/api/admin/*`

In questo modo l'interfaccia admin e l'API di scrittura passano entrambe da Zero Trust.

## 4) Contentful

Questo pacchetto si aspetta questi content type:

- `photo`
- `siteContent`
- `siteSettings`
- `publication`
- `talk`
- `series`

Dall'admin, tab impostazioni, puoi lanciare una volta il setup per creare/pubblicare i content type mancanti.

## 5) Campi di `siteSettings`

Usati da questo pacchetto:

- `key`
- `heroBanner`
- `backgroundColor`
- `textColor`
- `fontPrimary`
- `fontSizeBio`
- `fontSizePubs`

## 6) Cosa è stato cambiato

### Pubblico
- `index.html` ripulito dal JavaScript duplicato/rotto
- caricamento impostazioni da Contentful senza `localStorage`
- merge tra `siteContent` e `siteSettings`

### Admin
- rimosso login client-side con password hashata
- `admin/login.html` trasformato in entrypoint per Access
- niente token Contentful nel browser
- salvataggi admin tramite `/api/admin/*`
- i 5 campi visivi richiesti vengono letti/scritti su `siteSettings`

### Nota
L'admin mantiene ancora un piccolo uso di `sessionStorage` solo come fallback temporaneo per foto locali non pubblicate quando Contentful non è configurato. Non viene usato per configurazioni condivise del sito.
