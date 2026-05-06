try { require('dotenv').config(); } catch (_) { /* .env opcional */ }
const db = require('../db');
(async () => {
  await db.migrate();
  await db.seedIfEmpty();
  console.log('Datos demo listos: 20 choferes, 20 peonetas, 20 dueños de camión, empresas y escenarios de matching.');
  console.log('Empresa demo principal: rrhh@translog.example / demo123');
  console.log('Otros accesos: rrhh@rutanorte.test, operaciones@puertosanantonio.test, personas@ultimamilla.test / demo123');
  process.exit(0);
})();
