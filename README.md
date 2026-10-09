# Controle RS – Controle financeiro da RS Serviços e RS Gestões

Sistema web para controlar notas fiscais, boletos, pagamentos e recebimentos das duas empresas,
com leitura automática de PDF, XML, Excel e fotos, e relatórios para o contador.

## O que o sistema faz

| Área | Funções |
|---|---|
| **Painel** | Totais a pagar, vencidos, a receber, entradas e saídas do mês, vencimentos próximos e comparativo entre as empresas. |
| **Notas Fiscais / Contas** | Cole (Ctrl+V), arraste ou escolha PDFs de NF-e/NFS-e, XML, Excel/CSV ou fotos. O sistema identifica nº da nota, fornecedor/cliente, CNPJ, valor, emissão, vencimento e **boleto** (linha digitável, valor e vencimento). Pelo CNPJ ele descobre a empresa e se a nota é **a pagar** (recebida) ou **a receber** (emitida). Boleto enviado junto com a nota é ligado a ela automaticamente. Tudo pode ser revisado e editado manualmente. |
| **Extrato Bancário** | Envie o extrato (PDF, Excel, CSV ou OFX). Cada entrada/saída é lida e ligada à nota em aberto de mesmo valor, que recebe **baixa automática** (paga/recebida). Lançamentos repetidos são detectados. |
| **Pagamentos e Comprovantes** | Todos os pagamentos feitos e valores recebidos, com foto/PDF do comprovante e campo "a que se refere". Comprovantes enviados são lidos (valor, data, favorecido, PIX/boleto/TED) e ligados à nota correspondente. Lançamento manual também. |
| **Relatórios** | PDF de entradas e saídas por período e empresa (ou consolidado), totais por categoria, notas do período e contas em aberto. Exportação para Excel e **pacote para o contador** (.zip com PDF, Excel e todos os anexos). |
| **Configurações e Usuários** | CNPJ das empresas, inclusão/remoção de usuários e administradores, troca de senha e histórico de alterações (auditoria). |

As duas empresas ficam **separadas financeiramente** (cada registro pertence a uma delas). O seletor no topo
alterna entre *RS Serviços*, *RS Gestões* ou *Todas* (visão consolidada).

## Segurança

- Login com e-mail e senha (Firebase Authentication). O e-mail precisa ser **confirmado** antes de acessar qualquer dado.
- Só acessam os dados os e-mails autorizados: `natanaraujo.gg@gmail.com` e `tantosj1@gmail.com` (donos) e os usuários incluídos por um administrador.
- As regras do banco (`firestore.rules`) bloqueiam no servidor qualquer leitura/gravação de quem não está autorizado.
- Sessão encerra após 30 minutos sem uso; "manter conectado" é opcional.
- Toda criação, alteração, baixa e exclusão fica registrada na auditoria (não pode ser apagada).
- Anexos ficam no próprio banco, protegidos pelas mesmas regras (funciona no plano gratuito do Firebase).

### Primeiro acesso
1. Abra o site e clique em **Primeiro acesso**.
2. Informe seu e-mail (um dos autorizados) e crie a senha (mínimo 8 caracteres).
3. Clique no link de confirmação enviado por e-mail (veja também o spam) e depois em **Já confirmei**.
4. Os CNPJs já vêm cadastrados — **RS Serviços: 51.939.524/0001-83** e **RS Gestões: 14.115.280/0001-98** — e são usados para identificar automaticamente a empresa de cada nota. Em **Configurações e Usuários** dá para completar a razão social ou alterar o CNPJ.

Para incluir outra pessoa: **Configurações e Usuários → Incluir novo usuário**. Se informar uma senha inicial, a conta já é criada;
se deixar em branco, a pessoa usa **Primeiro acesso** com o e-mail liberado.

## Publicação no Firebase

### Opção A – pelo computador (mais rápida)
```bash
npm install
npx firebase login
bash scripts/criar-projeto-firebase.sh controle-rs-financeiro   # nome do projeto à sua escolha
```
O script cria o projeto, o app web, o banco Firestore (São Paulo), ativa o login por e-mail e publica o site em
`https://<projeto>.web.app`. Se o login por e-mail não puder ser ativado automaticamente, ative em
*Console Firebase → Authentication → Método de login → E-mail/senha*.

### Opção B – automática pelo GitHub
A cada push na branch `main`, o GitHub Actions testa, compila e publica (`.github/workflows/deploy.yml`). Para isso:
1. Crie o projeto no [Console do Firebase](https://console.firebase.google.com) (ou use a opção A uma vez), ative
   *Authentication → E-mail/senha*, crie o *Firestore Database* e registre um *app Web*.
2. Em *Configurações do projeto → Contas de serviço*, gere uma chave privada (JSON).
3. No GitHub: *Settings → Secrets and variables → Actions*:
   - Secret `FIREBASE_SERVICE_ACCOUNT` = conteúdo do JSON;
   - (opcional) Variable `FIREBASE_PROJECT_ID` — se não informada, usa o projeto da própria chave.
4. Rode o workflow *Publicar no Firebase* (aba Actions) ou faça um push na `main`.

## Desenvolvimento

```bash
npm install
npm test                 # testes dos leitores de documentos
npm run emuladores       # Firebase local (Auth + Firestore)
VITE_USE_EMULATOR=true VITE_FIREBASE_API_KEY=x VITE_FIREBASE_PROJECT_ID=demo-controle-rs \
  VITE_FIREBASE_AUTH_DOMAIN=localhost VITE_FIREBASE_APP_ID=1:1:web:1 npm run dev
```

Tecnologias: React + Vite, Firebase (Auth, Firestore, Hosting), pdf.js (leitura de PDF), Tesseract (leitura de fotos),
SheetJS (Excel), jsPDF (relatórios), JSZip.

### Observações sobre a leitura automática
- PDFs com texto (gerados pelo sistema da prefeitura/SEFAZ/banco) são lidos com mais precisão. PDFs escaneados e fotos
  usam reconhecimento de texto (OCR) — confira os valores na tela de revisão.
- O XML da NF-e/NFS-e é a fonte mais precisa: traz número, valores e parcelas de vencimento.
- Nada é salvo sem passar pela tela de conferência, onde todos os campos podem ser corrigidos.
