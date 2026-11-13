# DrawingBot

App para a CR-10 com MKS Gen V1.4 e firmware CR-10 Desenho / Marlin 2.1.2.

## Utilização

Abrir em Chrome ou Edge no computador ligado por USB (ou, com o Raspberry Pi, em `http://drawingbot.local` — ver `RASPBERRY-PI.md`) e escolher «Ligar máquina».
A app espera pelo arranque da placa a 115200 baud. Cada nova ligação invalida as referências:
fazer origem X/Y com caneta levantada, aproximar a ponta em passos de 0,1 mm e definir zero Z.
O botão define o contacto e levanta automaticamente a caneta. O suporte é flutuante: desenhar
normalmente a Z0, deixando a caneta assentar pelo peso.

Importar SVG, definir a espessura real do traço, posicionar e enviar. A pré-visualização e a
verificação de limites incluem o raio da tinta. Exportar G-code não inclui homing nem G92:
as referências têm de ser definidas no equipamento antes de executar o ficheiro por SD.

«Centro» mantém o eixo dos traços. «Por dentro» e «Por fora» deslocam contornos fechados em
metade da largura da ponta. Linhas abertas não são deslocadas. Contornos totalmente contidos
são tratados como recortes; sobreposições são unidas. Apenas os contornos são desenhados,
sem enchimento de áreas. Texto, imagens, símbolos SVG, recortes e efeitos devem ser convertidos
em caminhos simples no editor de origem. A espessura indicada deve ser medida no papel;
a marca nominal da ponta pode diferir do traço real.

Pausar e terminar deixam acabar movimentos já no planner e levantam a caneta. Emergência
envia M112 imediatamente e invalida as referências. M84 S0 mantém motores ativos; «Soltar
motores» liberta-os e exige novas referências. A cama fica desligada por defeito. O painel permite consultar a temperatura, pedir um alvo opcional
entre 0 e 60 °C e desligar o aquecimento. O desenho nunca espera pelo aquecimento.

No fim de um desenho completo (USB ou G-code exportado), a caneta sobe para Z10 mm.
Após confirmar o levantamento, Y avança até ao máximo configurado (300 mm por defeito),
sem alterar X. Pausar durante esta sequência mantém os 10 mm de folga.

## Desenhar na mesa

A barra por cima da mesa tem as ferramentas: Selecionar (V), Retângulo (R), Elipse (E), Polígono (P),
Estrela (S), Coração (H), Linha (L), Mão livre (F), Texto (T) e Importar SVG (I). Arrasta na mesa para
criar uma forma; um clique simples cria-a com 40 mm. Um desenho pode ter vários objetos.

- **Selecionar:** arrastar move; os cantos redimensionam; a pega redonda roda. Shift mantém a
  proporção (ou liberta-a, se «Manter proporção» estiver ativo) e roda de 15 em 15°.
- **Teclado:** Delete apaga, Ctrl+Z desfaz, Ctrl+Shift+Z ou Ctrl+Y refaz, Ctrl+D duplica,
  setas movem 1 mm (Shift: 10 mm), Esc volta a Selecionar.
- **Propriedades:** posição, tamanho e rotação exatos, lados do polígono, pontas da estrela e o
  preenchimento do objeto selecionado.
- **Preenchimentos:** cheio, linhas, quadriculado, ondas, ziguezague, concêntrico, espiral e pontos,
  com espaçamento e ângulo. O contorno fica meia ponta para dentro e o padrão roda com o objeto.
  As linhas vizinhas do padrão são ligadas sem levantar a caneta sempre que possível.
- O desenho fica guardado no browser e volta ao reabrir a app. «Guardar projeto» exporta-o em
  `.drawingbot.json`; projetos antigos continuam a abrir, com o desenho no mesmo sítio.

## Texto

«Escrever texto» abre a ferramenta de texto. Há dois modos, cada um com 8 tipos de letra
(2 serifados, 2 sem serifa, 2 técnicos e 2 divertidos):

- **Letra preenchida:** o contorno fica meia ponta para dentro e o interior é preenchido com linhas
  paralelas em ziguezague, com espaçamento ligeiramente inferior à ponta. A tinta respeita a forma da letra.
  Letras mais finas do que a ponta ficam só com o contorno.
- **Linha única:** cada letra é desenhada com um só traço, como num escantilhão (fontes Hershey e EMS).
  É muito mais rápido e serve bem para canetas finas.

A altura indicada é a das maiúsculas. Depois de aplicado, o texto comporta-se como um desenho:
a largura, a rotação e a posição ajustam-se no painel. A ferramenta de texto cria sempre um texto novo;
para alterar um texto, faz duplo clique nele na mesa (ou usa «Editar texto»). O texto também fica guardado nos projetos.

## Imprimir em espelho

«Imprimir em espelho» (no painel da caneta) troca esquerda e direita à volta do centro do papel.
Serve para desenhar no verso de uma película transparente: a tinta fica do lado protegido e o
desenho lê-se bem pela frente. A mesa continua a mostrar o desenho como será lido; o aviso
«Impressão em espelho» lembra que está ativo. Vale para o desenho direto, para o G-code exportado
(que o indica no cabeçalho) e para os projetos enviados ao Raspberry Pi.

## Cama aquecida: quando usar

A cama serve sobretudo para **secar a tinta mais depressa**. Só estabiliza o papel quando ele está
húmido ou ondulado. Para o manter quieto, prende-o à mesa com molas, fita de papel ou spray de
fixação reposicionável: o calor não substitui isso.

- **Tintas à base de água em zonas densas** (gel, caneta de aparo, marcadores de aguarela, brush pens):
  a 35–45 °C a tinta seca mais depressa e a caneta não arrasta tinta húmida nos preenchimentos
  cheios, quadriculados ou concêntricos. O papel também ondula menos.
- **Ceras e pastéis de óleo:** perto dos 60 °C (o máximo da app) muitas ceras amolecem e o traço fica
  mais cheio. O efeito é ligeiro: a encáustica a sério usa placas a 80–100 °C.
- **Papel húmido:** uns minutos a cerca de 40 °C antes de desenhar deixam-no mais plano.

Quando deixar desligada:

- **Fineliners e canetas finas:** a ponta fica perto de uma superfície quente, seca e começa a falhar.
- **Papel térmico** (talões, algumas etiquetas): escurece a partir de cerca de 60 °C.
- **Papel seco e comum:** o calor não ajuda e, em excesso, o papel arqueia ao secar.
  O suporte da caneta em PLA também amolece perto dos 60 °C.

O desenho nunca espera pelo aquecimento: define a temperatura em «Área útil e diagnóstico → Cama
opcional», espera que estabilize e só depois escolhe «Desenhar».

## Instalação local

```
npm ci
npm test
npm run build
python -m http.server 8787 --directory dist --bind 127.0.0.1
```

Abrir http://localhost:8787 no Chrome/Edge e instalar pelo menu do navegador.
HTTPS ou localhost são necessários para USB e service worker. A PWA também pode ser instalada
a partir do Site publicado. As dependências estão incluídas no bundle; não são necessários CDNs
em funcionamento. Projetos e preferências são locais, as referências da máquina não são persistidas.

Não executar outra aplicação serial em simultâneo. Desligar a sessão de diagnóstico Python
antes de selecionar a porta no navegador.

## Validação

Testes de geometria: raio da ponta, recortes, sobreposições, linhas abertas, contornos colapsados,
limites físicos da tinta e geração de G-code. Testes do protocolo: ACKs antigos, reinício, erros,
pausa/retoma e cancelamento. A validação em simulação não substitui o ensaio físico do navegador.

Referências: https://developer.chrome.com/docs/capabilities/serial
e https://github.com/junmer/clipper-lib/blob/master/Documentation.md

Clipper e svgpath conservam as respetivas licenças nos pacotes de origem e nos avisos do bundle.
