// Casos reais das pesquisas modelo de nov/2026 (fichas como o vendedor entregou).
// Rodar: npm run test:ficha
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saneaFicha } from '../ficha-sanity.js';

const f = (marca, modelo, ficha) => saneaFicha(ficha, marca, modelo).ficha;

test('tração traseira em esportivos que o vendedor marcou como dianteira', () => {
  for (const [marca, modelo] of [
    ['Ford', 'Mustang GT Performance 5.0 V8 Mec.'],
    ['Ford', 'Mustang Dark Horse 5.0 V8 Aut.'],
    ['GM - Chevrolet', 'Camaro SS Conversível 6.2 V8 16V'],
    ['BMW', 'M4 Coupe 3.0 Bi-Turbo 24V 431cv 2p'],
    ['BMW', 'M2 Competition Ed. Espe. 3.0 Bi-TB Mec.'],
    ['BMW', 'M6 Gran Coupe 4.4 Bi-Turbo V8 32V 560cv'],
    ['BMW', '650i Gran Coupe 4.4 V8 450cv 4p'],
    ['BMW', 'Z4 Roadster sDRIVE 30i MSport 2.0 TB Aut'],
    ['BMW', '420i Cabriolet M Sport 2.0 TB 16V 2p.'],
    ['Mercedes-Benz', 'C-63 S Coupe AMG 4.0 V8  Bi-Turbo Aut.'],
  ]) assert.equal(f(marca, modelo, { tracao: 'Dianteira' }).tracao, 'Traseira', modelo);
});

test('tração vazia é preenchida só quando a lista prova', () => {
  assert.equal(f('Porsche', '718 Cayman GTS 4.0 400cv', { tracao: '' }).tracao, 'Traseira');
  assert.equal(f('Jaguar', 'XKR Coupe  4.2/5.0 32V', { tracao: '' }).tracao, 'Traseira');
  assert.equal(f('ASTON MARTIN', 'Vantage Coupe 4.7 V8 425cv', { tracao: '' }).tracao, 'Traseira');
  // Sem prova: fica em branco.
  assert.equal(f('Toyota', 'Corolla XEi 2.0 Flex Aut.', { tracao: '' }).tracao, '');
});

test('não mexe em carro de tração dianteira nem em integral sem marca no nome', () => {
  assert.equal(f('BMW', 'X1 SDRIVE 20i M Sport 2.0 TB Aut.', { tracao: 'Dianteira' }).tracao, 'Dianteira');
  assert.equal(f('BMW', 'M235i Gran Coupé 2.0', { tracao: 'Dianteira' }).tracao, 'Dianteira');
  assert.equal(f('BMW', 'M440i Coupe 3.0 TB Aut.', { tracao: '4x4' }).tracao, '4x4');
  assert.equal(f('BMW', 'M5 Competition 4.4 V8', { tracao: '4x4' }).tracao, '4x4');
  assert.equal(f('Porsche', '911 Carrera 4S 3.0', { tracao: '' }).tracao, '');
  assert.equal(f('Mercedes-Benz', 'GLC-43 AMG Coupe 3.0 V6 Bi-TB Aut.', { tracao: '' }).tracao, '');
  assert.equal(f('Mercedes-Benz', 'EQA 250 AMG Line (Elétrico)', { tracao: 'Dianteira' }).tracao, 'Dianteira');
});

test('marca de integral no nome vence a ficha', () => {
  assert.equal(f('BMW', 'M850i XDrive Coupé 4.4 V8 530cv Aut.', { tracao: 'Traseira' }).tracao, '4x4');
  assert.equal(f('Audi', 'Q5 Perf. Black 2.0 TFSIe S.Tr. Qt (Hib.)', { tracao: 'Quattro' }).tracao, '4x4');
  assert.equal(f('Mercedes-Benz', 'CLA-45 S AMG 4MATIC CGI 2.0 TB Aut.', { tracao: 'Dianteira' }).tracao, '4x4');
  assert.equal(f('Lexus', 'RX-450h+ AWD 2.5 16V Aut. (Híbrido)', { tracao: 'AWD' }).tracao, '4x4');
});

test('potência do nome FIPE manda; faixa "315/319cv" não decide', () => {
  assert.equal(f('BMW', 'M850i XDrive Coupé 4.4 V8 530cv Aut.', { potencia: '523 cv' }).potencia, '530 cv');
  assert.equal(f('BMW', 'X2 M35i xDrive 2.0 Turbo 317cv Aut.', { potencia: '306 cv' }).potencia, '317 cv');
  assert.equal(f('Porsche', 'Boxster S 3.4 315/319cv', { potencia: '300 cv' }).potencia, '300 cv');
  assert.equal(f('Ford', 'Mustang GT Performance 5.0 V8 Mec.', { potencia: '488 cv' }).potencia, '488 cv');
});

test('câmbio contradito pelo nome', () => {
  assert.equal(f('Ford', 'Mustang Dark Horse 5.0 V8 Aut.', { cambio: 'Manual 6 marchas' }).cambio, 'Automático');
  assert.equal(f('Ford', 'Mustang GT Performance 5.0 V8 Mec.', { cambio: 'Automático 10 marchas' }).cambio, 'Manual');
  assert.equal(f('Ford', 'Mustang GT Performance 5.0 V8 Mec.', { cambio: 'Manual 6 marchas' }).cambio, 'Manual 6 marchas');
  assert.equal(f('VW', 'Gol Autêntico 1.0', { cambio: 'Manual 5 marchas' }).cambio, 'Manual 5 marchas');
});

test('torque em Nm vira kgfm', () => {
  assert.equal(f('BMW', 'M2 Competition Ed. Espe. 3.0 Bi-TB Mec.', { torque: '550 Nm' }).torque, '56,1 kgfm');
  assert.equal(f('BMW', 'Z4 Roadster sDRIVE 30i MSport 2.0 TB Aut', { torque: '400 Nm' }).torque, '40,8 kgfm');
  assert.equal(f('Audi', 'RS3 Sedan 2.5 TFSI Quattro S-tronic', { torque: '51,0 kgfm' }).torque, '51,0 kgfm');
});

test('idempotente e não muta a entrada', () => {
  const ent = { tracao: 'Dianteira', torque: '550 Nm' };
  const uma = f('BMW', 'M2 Competition Ed. Espe. 3.0 Bi-TB Mec.', ent);
  assert.deepEqual(f('BMW', 'M2 Competition Ed. Espe. 3.0 Bi-TB Mec.', uma), uma);
  assert.equal(ent.tracao, 'Dianteira');
});
