# COVI

### Conversor Otimizado de Vários formatos de Imagem

**Converta. Simplifique. Pronto.**

Converta fotos HEIC e HEIF do iPhone para **JPG**, **PNG** ou **WebP**. O COVI
funciona offline: seus arquivos são processados no próprio computador e os
originais são preservados.

## Baixar

Baixe o instalador para seu sistema operacional na página de
[releases do COVI](https://github.com/Alexandre-Gervasio/COVI/releases/latest).

## Recursos

- Converta uma ou várias fotos de uma só vez.
- Escolha o formato de saída e ajuste a qualidade.
- Use o monitoramento da pasta Downloads para receber um aviso quando novas
  fotos HEIC/HEIF forem baixadas.
- Mantenha os arquivos originais: as conversões são salvas como cópias.

## Começar

### Executar em desenvolvimento

```bash
npm install
npm start
```

### Gerar um instalador

```bash
npm run dist
```

Os instaladores são gerados na pasta `dist/`. O formato depende do sistema
operacional:

- **Windows:** `.exe`
- **macOS:** `.dmg`
- **Linux:** `.AppImage` e `.deb`

## Gerar instaladores para todas as plataformas

Envie o projeto para o GitHub e execute a ação **Build** na aba **Actions**.
Também é possível iniciar o fluxo criando uma tag de versão, por exemplo
`v1.0.0`. Os instaladores ficam disponíveis como artifacts da execução.

## Conversão automática

O COVI pode permanecer na bandeja do sistema e monitorar a pasta Downloads.
Quando uma foto `.heic` ou `.heif` termina de baixar, o app mostra um aviso
para iniciar a conversão. A cópia convertida é salva na mesma pasta; o arquivo
original não é alterado.

Use o menu da bandeja para ativar ou desativar os avisos e, no Windows e no
macOS, para escolher se o COVI inicia junto com o sistema. No Linux, configure
o início automático nas opções da sua distribuição.
