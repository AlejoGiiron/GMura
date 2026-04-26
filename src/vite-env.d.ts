/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GMURA_SUPABASE_URL: string
  readonly VITE_GMURA_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
