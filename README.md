# batimento-externo

Vigia de fora de uma maquina de trabalho. A maquina grava `pulso-publico.json` aqui uma vez por hora
(so a hora do sinal e dois sim/nao, nenhum dado interno). O workflow `vigia de fora` roda no GitHub de 3 em
3 horas e alarma pela AUSENCIA do sinal: abre uma issue por problema e falha de proposito para o e-mail chegar.
