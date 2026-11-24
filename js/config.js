/* AGROPERIT Parcelário – ligação à base partilhada (Supabase).
   Deixe os dois campos vazios ('') para usar o site só no seu computador, sem login.
   Para a base partilhada, cole aqui o "Project URL" e a chave "anon public" do Supabase
   (NUNCA a chave "service_role"). Estes dois valores podem ser públicos: os dados só abrem com login. */
window.AGROPERIT_CONFIG = {
  supabaseUrl: 'https://ifdbjwtidsyxzzyjddqh.supabase.co/rest/v1/',
  supabaseKey: 'sb_publishable_0iZfMpaJsbezg_HMqFiWQA_I8V-Dbcc',
  manterSessao: false   // false = ao fechar o navegador tem de voltar a entrar (mais seguro)
};
