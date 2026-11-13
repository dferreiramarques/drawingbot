# DrawingBot no Raspberry Pi Zero 2 W

O Pi fica ligado à CR-10 por USB e serve a app na rede local. Os projetos são enviados para o Pi
e é o Pi que envia os comandos à máquina: o desenho continua se o browser fechar, o telemóvel
bloquear ou o Wi-Fi do computador falhar. Ao reabrir a página vês o progresso e podes pausar ou terminar.

## Material

- Raspberry Pi Zero 2 W e cartão microSD (8 GB ou mais).
- Fonte de alimentação própria para o Pi (5 V, 2,5 A).
- Adaptador **micro-USB OTG → USB-A** para o cabo USB da placa MKS (porta «USB» do Pi, não «PWR»).
- Rede Wi-Fi de 2,4 GHz (o Zero 2 W não usa 5 GHz).

## Instalação

1. No **Raspberry Pi Imager**, escolher *Raspberry Pi Zero 2 W* → *Raspberry Pi OS Lite (64-bit)*.
   Em «Editar definições»: nome `drawingbot`, utilizador e palavra-passe, a rede Wi-Fi e o país,
   e ativar **SSH**. Gravar o cartão e arrancar o Pi.
2. Ligar por SSH a partir do computador:
   ```sh
   ssh <utilizador>@drawingbot.local
   ```
3. Instalar:
   ```sh
   curl -fsSL https://dferreiramarques.github.io/drawingbot/pi/install.sh | sudo bash
   ```
   O instalador põe o Node.js, a app em `/opt/drawingbot`, os projetos em `/var/lib/drawingbot`,
   os serviços `drawingbot` e `drawingbot-config`, e cria `drawingbot.txt` na partição de arranque.
4. Ligar a CR-10 ao Pi por USB e abrir **http://drawingbot.local** no browser de qualquer
   computador, tablet ou telemóvel da mesma rede. A ligação à máquina é automática.

Para atualizar, repetir o passo 3. Os projetos e o `drawingbot.txt` são mantidos.

Sem internet no Pi: copiar `drawingbot-pi.tar.gz` (de `npm run build:pi` ou de
`https://dferreiramarques.github.io/drawingbot/pi/drawingbot-pi.tar.gz`) com `scp`, e depois
`tar -xzf drawingbot-pi.tar.gz && sudo bash drawingbot/install.sh` (o Node.js tem de estar instalado).

## `drawingbot.txt`: Wi-Fi, nome e PIN

Fica na raiz da partição **bootfs** do cartão SD, a que aparece no Windows ou no macOS quando
se insere o cartão. Edita-se com o Bloco de Notas ou o TextEdit e é aplicado no próximo arranque.

```ini
wifi_ssid=A minha rede
wifi_password=palavra-passe
wifi_hidden=no
wifi_country=PT
hostname=drawingbot
pin=
serial_port=auto
```

- **wifi_ssid / wifi_password**: rede a usar. Vazio mantém a rede atual (por exemplo a do Imager).
  A nova rede tem prioridade; a anterior continua guardada como alternativa.
- **wifi_country**: obrigatório para o Wi-Fi funcionar com os canais certos.
- **hostname**: a app fica em `http://<hostname>.local`.
- **pin**: se preenchido, o browser pede o PIN antes de controlar a máquina. Sem PIN, qualquer
  pessoa na rede pode mover a máquina.
- **serial_port**: `auto` encontra a CR-10; também aceita por exemplo `/dev/ttyUSB0`.

Por SSH: `sudo nano /boot/firmware/drawingbot.txt` e depois `sudo drawingbot-apply-config`
para aplicar sem reiniciar. Atenção: mudar a rede por SSH pode terminar a própria sessão SSH.

A palavra-passe do Wi-Fi fica em texto simples no cartão, como em qualquer configuração por ficheiro.

## Utilização

- **Enviar para o DrawingBot** guarda o projeto atual no Pi.
- **Enviar e desenhar** guarda e começa logo, depois da origem X/Y e do contacto Z.
- **Projetos no DrawingBot** lista o que está guardado: *Abrir* carrega no editor, *Desenhar* corre
  no Pi, *Apagar* remove.
- Projetos `.drawingbot.json` (ou os antigos `.pen-studio.json`) abertos com «Abrir projeto» também
  podem ser enviados.
- A origem X/Y e o zero Z ficam no Pi enquanto a máquina estiver ligada: recarregar a página não os perde.

Como a página do Pi é servida por `http` na rede local, o browser não a instala como app nem a guarda
para uso offline; a versão do GitHub Pages continua a funcionar por USB direto.

## Diagnóstico

```sh
systemctl status drawingbot
journalctl -u drawingbot -f
journalctl -u drawingbot-config -b
```

- `drawingbot.local` não abre: alguns Android antigos não resolvem `.local`; usar o IP
  (`hostname -I` no Pi ou na lista de dispositivos do router).
- «A CR-10 não foi encontrada»: verificar o adaptador OTG e `ls /dev/serial/by-id/`.
- «A placa não tem o firmware de desenho»: a placa tem de ter o Marlin de `firmware/`.

## Ainda não verificado

O servidor, o instalador e o `drawingbot.txt` foram testados em simulação e em modo de ensaio.
Falta o ensaio num Pi Zero 2 W real com a CR-10 (porta série, Wi-Fi por `drawingbot.txt` e mudança de nome).
