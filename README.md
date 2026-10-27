# C.O.V.I.

### Conversor Otimizado de Vários formatos de Imagem

**Converta. Simplifique. Pronto.**

A versão instalada aparece ao lado do nome do aplicativo.

Converta fotos HEIC e HEIF do iPhone para **PNG** ou **JPG**. O C.O.V.I.
funciona offline: seus arquivos são processados no próprio computador e os
originais são preservados, a menos que você escolha substituí-los.

## Baixar

Baixe o instalador para seu sistema operacional na página de
[releases do C.O.V.I.](https://github.com/Alexandre-Gervasio/COVI/releases/latest).

## Recursos

- Converta uma ou várias fotos de uma só vez.
- Escolha PNG para preservar os pixels decodificados ou JPG, que pode reduzir
  a qualidade por usar compressão com perda.
- Use a segunda aba para converter imagens raster compatíveis para PNG, TIFF
  sem compressão, WebP/AVIF lossless, JPG, WebP, AVIF ou GIF. As opções com
  perda são identificadas no seletor e variam conforme a imagem e a instalação.
- Use o monitoramento da pasta Downloads para receber um aviso quando novas
  fotos HEIC/HEIF forem baixadas.
- Inicie o C.O.V.I. automaticamente com a sessão do usuário. Essa opção pode
  ser alterada pelo menu da bandeja.
- Nas abas manuais, a opção de substituir o original fica marcada por padrão
  e pede confirmação; desmarque-a para manter os originais e salvar cópias.
- Receba avisos quando uma nova versão do C.O.V.I. estiver disponível.
- Use **Verificar atualizações** na janela do aplicativo para procurar uma versão
  nova; no Windows e no Linux AppImage, o botão também permite reiniciar para
  concluir uma atualização baixada.

Na segunda aba, a lista de entradas é determinada pelos decodificadores
incluídos na versão e pode variar por sistema operacional. Arquivos animados,
com várias páginas ou com profundidade/espaço de cor não preservável são
recusados. JPG, GIF, WebP e AVIF com perda podem alterar pixels, cores ou
transparência; GIF também limita a paleta a 256 cores.

## Atualizações

O C.O.V.I. verifica novas versões ao iniciar, periodicamente enquanto está aberto
e quando você clica em **Verificar atualizações**.
No Windows e no Linux AppImage, baixa as atualizações em segundo plano e as
instala ao sair ou ao escolher **Reiniciar agora** no aviso. No macOS e na
versão Linux `.deb`, o aviso abre a página pública para baixar a nova versão.
É necessária conexão com a internet apenas para consultar e baixar atualizações;
a conversão de imagens continua funcionando offline.

## Organização do código

- `main.js`: inicialização do Electron e integração dos serviços.
- `src/main/`: conversão de imagens, atualizações, preferências, avisos e
  monitoramento da pasta Downloads.
- `src/renderer/`: interface, estilos e fluxos de conversão.
- `preload.js`: ponte controlada entre a interface e o processo principal.

O `.gitignore` exclui dependências, builds, logs e arquivos de ambiente locais.
Ele evita que esses arquivos sejam adicionados ao Git por engano, mas não impede
a cópia do código-fonte que já está publicado no repositório público.

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

No instalador do Windows, escolha se deseja criar atalhos na área de trabalho e
no menu Iniciar. As duas opções vêm selecionadas por padrão.

## Gerar instaladores para todas as plataformas

Envie o projeto para o GitHub e execute a ação **Build** na aba **Actions**.
Também é possível iniciar o fluxo criando uma tag de versão, por exemplo
`v1.0.0`. Os instaladores ficam disponíveis como artifacts da execução.

## Conversão automática

O C.O.V.I. pode permanecer na bandeja do sistema e monitorar a pasta Downloads.
Quando uma foto `.heic` ou `.heif` termina de baixar, o app mostra um aviso
para iniciar a conversão. A cópia convertida é salva na mesma pasta; o arquivo
original não é alterado.

Use o menu da bandeja para ativar ou desativar os avisos e, no Windows e no
macOS, para escolher se o C.O.V.I. inicia junto com o sistema. No Linux, configure
o início automático nas opções da sua distribuição.
