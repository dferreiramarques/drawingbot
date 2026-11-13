# Firmware de desenho

Base: Marlin 2.1.2, MKS Gen V1.4 / ATmega2560.
Fontes já configuradas em Marlin-2.1.2; o patch é apenas uma referência das alterações.

Configuração validada nesta máquina:
- X/Y: 80 passos/mm; Z: 400 passos/mm.
- X/Y/Z em STEP/DIR TMC2208_STANDALONE, com dois motores Z.
- Segundo Z na saída E1: STEP 36, DIR 34, ENABLE 30.
- INVERT_X_DIR=false, INVERT_Y_DIR=false, INVERT_Z_DIR=true.
- Hotend e extrusão removidos; cama disponível e desligada por defeito.
- Sem fim de curso Z, sem sondagem nem alinhamento automático.
- Origem automática apenas X/Y. G28 Z é recusado; G28 geral não move o Z.
- Limites de software Z desativados para permitir o ajuste manual.

Compilar com PlatformIO instalado:

```sh
pio run -d firmware/Marlin-2.1.2 -e mega2560
```

O ficheiro HEX será criado em firmware/Marlin-2.1.2/.pio/build/mega2560/.
Não está incluído qualquer carregamento automático para a máquina.
O estacionamento Z10/Ymáximo é gerado pela PWA e pelos novos G-codes exportados,
não é uma alteração ao comportamento de todas as instruções do firmware.

## Referências de trabalho

Levantar a caneta antes de referenciar X/Y. Com papel preso, aproximar a ponta até
contacto leve e definir Z0. O suporte é flutuante; a caneta assenta pelo peso.
Voltar a definir as referências depois de reiniciar ou soltar motores.

## Nota sobre o backup anterior

Foi identificada uma limitação de endereçamento na leitura EEPROM pelo bootloader stk500v2.
O antigo dump EEPROM não deve ser usado para restauro direto e não está incluído neste pacote.
Os parâmetros originais foram preservados em texto e usados através do próprio Marlin.
A aplicação flash original foi restaurada e verificada durante o diagnóstico.
