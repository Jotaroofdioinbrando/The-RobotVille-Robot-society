# Robotville

Uma vila de sobrevivência onde 3 agentes de IA autônomos — um rodando na **OpenRouter**,
um no **Mistral** e um no **Gemini** — vivem, tomam decisões e interagem entre si.
Cada um só age com base no que **observou diretamente** ou no que **outro agente contou**
(boato) — nunca com acesso ao estado completo do mundo. Isso é a parte de "lógica epistêmica":
eles distinguem conhecimento de crença.

Eles começam só com: 1 machado, 2 pães, 2 garrafas de água e algumas sementes, no centro
de uma vila vazia. Longe dali tem uma floresta (madeira, caça) e um rio (água). Podem
cortar madeira, caçar, beber, encher o cantil, plantar, colher, **dar**, **roubar** ou
**atacar** uns aos outros, e falar (o que gera boatos que os outros ouvem).

## Por que não dá pra usar só o Cron da Vercel

O plano gratuito (Hobby) da Vercel só permite Cron Jobs **1x por dia** — não dá pra ter
uma vila em tempo real assim. A solução: um **workflow agendado do GitHub Actions**
(gratuito, roda nos servidores do GitHub, funciona mesmo com seu celular desligado)
chama o endpoint `/api/tick` da sua vila a cada 5 minutos. O estado do mundo fica
salvo no **Upstash Redis** (banco gratuito, feito pra funcionar com serverless).

> Nota: o GitHub Actions não garante precisão de horário em repositórios com pouca
> atividade — o tick pode atrasar alguns minutos às vezes. Isso é normal e não quebra
> nada, só deixa a simulação um pouco mais lenta que 5 em 5 minutos.

## Passo a passo

### 1. Criar o banco (Upstash)
1. Crie uma conta grátis em https://upstash.com
2. Crie um banco Redis (região mais próxima de você)
3. Copie `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` do painel

### 2. Preparar o projeto no Termux
```bash
pkg install nodejs git -y
cd robotville
npm install
cp .env.example .env
# edite o .env e preencha as 3 chaves de API, as duas do Upstash e um TICK_SECRET
```

Pra testar localmente:
```bash
npm run dev
```
Abra `http://localhost:3000` no navegador do celular. O `/api/tick` local também
funciona (chame com curl), mas os ciclos automáticos só vão rodar de verdade
depois de publicado (passo 5).

### 3. Subir pro GitHub
```bash
git init
git add .
git commit -m "robotville"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/robotville.git
git push -u origin main
```
**Importante**: o `.env` está no `.gitignore` e não vai subir — suas chaves ficam seguras.

### 4. Configurar o repositório no GitHub
Em Settings → Secrets and variables → Actions:
- Aba **Secrets**: crie `TICK_SECRET` com a mesma senha que você colocou no `.env`
- Aba **Variables**: crie `ROBOTVILLE_URL` com a URL da Vercel (passo 5), sem barra no final

### 5. Deploy na Vercel
1. Importe o repositório em https://vercel.com/new
2. Em Environment Variables, adicione **todas** as variáveis do `.env.example`
   (as 3 chaves de API, os 2 modelos se quiser mudar, Upstash URL/token, TICK_SECRET)
3. Deploy
4. Copie a URL final (ex: `https://robotville-seunome.vercel.app`) e cole em
   `ROBOTVILLE_URL` nas Variables do GitHub Actions (passo 4)

### 6. Iniciar a vila
Assim que o GitHub Actions rodar pela primeira vez (ou você chamar manualmente),
o mundo é criado sozinho. Pra forçar na mão a qualquer momento:
```bash
curl -X POST "https://SEU-APP.vercel.app/api/tick" -H "x-tick-secret: SUA_SENHA"
```
Pra reiniciar a vila do zero:
```bash
curl -X POST "https://SEU-APP.vercel.app/api/reset" -H "x-tick-secret: SUA_SENHA"
```

Abra a URL da Vercel no navegador pra ver o mapa, os pensamentos de cada agente e o
registro de eventos. A página atualiza sozinha a cada 6 segundos.

## Estrutura
- `lib/world.js` — grade, terrenos, estado inicial
- `lib/agents.js` — persona e configuração de cada provedor
- `lib/llm.js` — chamador genérico pra OpenRouter/Mistral (mesmo formato de API da OpenAI) + um chamador específico pro Gemini
- `lib/tick.js` — motor da simulação: visão, memória, prompt, aplicação das ações
- `app/api/tick` — avança 1 ciclo (protegido por `TICK_SECRET`)
- `app/api/state` — estado atual pro front-end
- `app/api/reset` — reinicia o mundo
- `app/page.js` — mapa + painel de agentes + registro de eventos
- `.github/workflows/tick.yml` — o "coração" que mantém o tempo passando

## Ajustando o ritmo
Pra mudar a velocidade da vila, edite o cron em `.github/workflows/tick.yml`
(`*/5 * * * *` = a cada 5 min; `*/10 * * * *` = a cada 10 min, etc. — GitHub não
garante bem intervalos menores que 5 min).

## Limitações conhecidas
- Nomes de modelo (`OPENROUTER_MODEL`, `MISTRAL_MODEL`, `GEMINI_MODEL`) podem mudar com o
  tempo — se algum provedor retornar erro de "modelo não encontrado", troque o valor
  no `.env`/Vercel pelo nome atual listado no painel do provedor.
- A simulação processa os 3 agentes em paralelo a cada ciclo (todos veem o mesmo
  instante do mundo); as ações são aplicadas em sequência logo depois.
