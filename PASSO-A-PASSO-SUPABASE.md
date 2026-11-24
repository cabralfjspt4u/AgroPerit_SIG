# Base partilhada online: passo a passo (Supabase)

**Como fica:** uma pessoa (o administrador) carrega os Excel; até 5 pessoas, todas convidadas por si, consultam os mesmos dados. Ninguém se regista sozinho. Os nomes e NIF ficam numa base de dados protegida por login, não no GitHub.

Os nomes dos menus do Supabase mudam de vez em quando; se um nome não for exatamente este, procure o parecido.

## Parte 1 – Criar a base (uma só vez, cerca de 20 minutos)

**1. Criar o projeto**
1. Vá a **supabase.com**, clique em **Start your project** e entre.
2. Clique em **New project**. Nome: `AGROPERIT`. Em *Database password* escolha uma palavra-passe forte e **guarde-a** (não é a das pessoas). Em *Region* escolha uma da **Europa**.
3. Clique em **Create new project** e espere uns 2 minutos.

**2. Criar as tabelas**
1. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
2. No GitHub, abra o ficheiro `sql/supabase-setup.sql` do repositório, copie **tudo** e cole no Supabase.
3. Clique em **Run**. Deve aparecer "Success".

**3. Dizer quem faz parte da equipa (e quem carrega dados)**
1. Ainda no **SQL Editor**, clique em **New query** e cole isto, trocando pelos emails verdadeiros:
```sql
insert into public.equipa (email, papel) values
  ('o.seu@email.pt',   'admin'),
  ('pessoa2@email.pt', 'leitor'),
  ('pessoa3@email.pt', 'leitor'),
  ('pessoa4@email.pt', 'leitor'),
  ('pessoa5@email.pt', 'leitor')
on conflict (email) do update set papel = excluded.papel;
```
2. Clique em **Run**. **admin** = pode carregar dados. **leitor** = só consulta. Só entra quem estiver nesta lista.

**4. Fechar o registo livre**
1. Clique em **Authentication** e depois em **Sign In / Providers** (ou *Settings*).
2. Desligue **Allow new users to sign up** e grave.

**5. Criar as contas (o "convite")**
1. Em **Authentication → Users**, clique em **Add user → Create new user**.
2. Escreva o email e uma palavra-passe provisória. Marque **Auto Confirm User**. Clique em **Create user**.
3. Repita para cada pessoa. Entregue a cada uma o email e a palavra-passe provisória por um meio seguro. Cada pessoa pode depois mudar a sua com "Esqueci-me da palavra-passe".
4. (Alternativa: **Invite user** envia um email com um link para a pessoa definir a palavra-passe. Precisa do passo 6.)

**6. Indicar o endereço do site**
1. Em **Authentication → URL Configuration**, em **Site URL**, escreva o endereço do seu site (por exemplo `https://O-SEU-UTILIZADOR.github.io/agroperit-parcelario/`) e grave.

**7. Copiar os dados de ligação**
1. Clique na roda dentada **Project Settings** e depois em **API** (ou *Data API / API Keys*).
2. Copie o **Project URL** e a chave **anon / public**.
3. **Nunca** copie nem partilhe a chave **service_role**.

**8. Colar no site**
1. No GitHub, abra o repositório, entre na pasta `js` e abra `config.js`.
2. Clique no lápis (**Edit**) e cole o URL e a chave entre as aspas `''`. Clique em **Commit changes**.

## Parte 2 – Manter a base sempre ativa (muito importante)

O plano gratuito do Supabase pausa o projeto quando passa cerca de uma semana sem atividade. O repositório já traz uma rotina que "acorda" a base de 2 em 2 dias, sozinha.
1. No GitHub, clique no separador **Actions**. Se pedir, clique em **I understand my workflows, go ahead and enable them**.
2. Clique em **Manter a base ativa** e depois em **Run workflow**.
3. Passado um minuto deve aparecer um visto **verde**. A partir daí corre sozinha.
4. Se alguma vez ficar a **vermelho**, abra-a e veja a mensagem. Quase sempre é o `config.js` sem os dados, ou o projeto já pausado.
5. Se o projeto chegar a pausar, no Supabase clique em **Restore project**. Os dados mantêm-se durante algum tempo.

Nota: o GitHub desliga rotinas agendadas em repositórios públicos sem atividade durante 60 dias. A rotina faz sozinha uma pequena "atividade" antes disso, mas convém ver o separador Actions de vez em quando.

## Parte 3 – No dia a dia

- **Administrador:** abre `base.html`, entra, clica em **Escolher Excel(s)**. O que é novo ou mudou é publicado sozinho (aparece "Publicado na nuvem"). Também obtém os polígonos do IFAP aqui.
- **Os outros:** entram e veem os dados. Para ver os dados mais recentes clicam em **Atualizar da nuvem**.
- **Terminar sessão** apaga os dados da memória do navegador. Nada fica guardado no computador de quem consulta.
- **Se o administrador mudar de computador:** não há problema, a base está na nuvem.

## Retirar ou acrescentar pessoas
- **Retirar:** no **SQL Editor** execute `delete from public.equipa where email = 'pessoa@email.pt';` e apague a conta em **Authentication → Users**.
- **Acrescentar:** repita os passos 3 e 5 da Parte 1.

## Cópias de segurança
Tanto quanto sei, o plano gratuito não faz cópias automáticas diárias (confirme). Por isso o administrador deve guardar de vez em quando **Guardar cópia compactada** e conservá-la num sítio seguro, **nunca no GitHub**.

## Segurança em resumo
- A chave `anon` pode estar no site: sem login, a base não devolve nada.
- Só quem estiver na tabela `equipa` e tiver conta criada entra.
- Só o `admin` consegue escrever.
- Use palavras-passe fortes e diferentes das de outros serviços.
- Os NIF e nomes passam a estar num serviço de terceiros (Supabase). Tem de cumprir o RGPD: valide com um jurista ou com o encarregado de proteção de dados.
