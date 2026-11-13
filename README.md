# Drawing Robot / Pen Studio

Conversão de uma CR-10 numa máquina de desenho com canetas flutuantes.
Inclui a PWA Pen Studio e o firmware Marlin configurado para a máquina.

## PWA

Requisitos: Node.js e npm. Para o lançador local, Python 3.

```sh
npm ci
npm test
npm run build
python -m http.server 8788 --bind 127.0.0.1 --directory dist
```

Abrir http://localhost:8788 em Chrome ou Edge. A ligação USB usa 115200 baud.
A app é instalável como PWA e funciona offline depois da primeira abertura.
No Windows também é possível abrir `local/Abrir Pen Studio.cmd` depois da compilação.

Para publicar num alojamento estático, compilar e publicar o conteúdo de `dist/` por HTTPS.
Não são necessárias chaves, credenciais ou contas de serviços para executar a cópia local.
A ligação USB pelo navegador exige selecionar a porta no próprio navegador.

## Funcionalidades

- Importação SVG, tamanho, rotação e posição na cama.
- Espessura real da ponta; compensação de contornos por meia espessura, por dentro ou fora.
- Linhas abertas mantêm o eixo; texto e símbolos devem ser convertidos em caminhos.
- Controlo USB, origem X/Y, zero Z manual e suporte flutuante pelo peso da caneta.
- Pausa/retoma, terminação controlada e emergência M112.
- No fim de um desenho completo: levantar para Z10 mm, aguardar e levar Y ao máximo configurado.
- Exportação G-code, projetos JSON e cama opcional sem espera por aquecimento.

O G-code exportado não faz homing nem define o zero: as referências são manuais.
Consultar `docs/PEN-STUDIO.md` para os pormenores de utilização e limitações SVG.

## Firmware

Fontes completas configuradas em `firmware/Marlin-2.1.2/`.
Consultar `firmware/README.md` antes de compilar.
O build da PWA não compila nem instala firmware automaticamente.

## Estrutura

- `src/`, `public/`: código e recursos da PWA.
- `tests/`: testes de geometria, comunicação e fim de desenho.
- `local/`: lançador Windows e servidor local, sem dependências Python externas.
- `firmware/`: Marlin, configuração e patch face à versão oficial.
- `docs/`: utilização e registo de validação.

## Git

Este ZIP não inclui histórico `.git`, dependências instaladas, resultados de compilação,
credenciais de publicação, configuração de alojamento ligada à conta ou backups da máquina.

```sh
git init
git add .
git commit -m "Initial Drawing Robot project"
```

## Licenças

O Marlin conserva a licença GPL e os avisos originais dentro da pasta do firmware.
Os avisos das bibliotecas de geometria estão em `public/THIRD-PARTY.txt` e `public/vendor/`.
Não é atribuída uma licença adicional ao código próprio neste pacote.
