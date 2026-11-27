const PDFDocument = require('pdfkit');

const fmt = (d) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

// Génère le reçu d'emprunt au format PDF, en mémoire (aucune écriture disque :
// compatible avec un système de fichiers racine en lecture seule).
function renderReceipt(loan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 40, info: { Title: `Reçu d'emprunt n°${loan.id}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('Bibliothèque municipale', { align: 'center' });
    doc.moveDown(0.3).fontSize(12).fillColor('#555').text("Reçu d'emprunt", { align: 'center' });
    doc.moveDown(1.5).fillColor('#000').fontSize(11);
    doc.text(`N° d'emprunt : ${loan.id}`);
    doc.text(`Lecteur : ${loan.user_email}`);
    doc.moveDown(0.5);
    doc.text(`Ouvrage : ${loan.book_title}`);
    doc.text(`Auteur : ${loan.book_author}`);
    doc.moveDown(0.5);
    doc.text(`Emprunté le : ${fmt(loan.borrowed_at)}`);
    doc.font('Helvetica-Bold').text(`À rendre avant le : ${fmt(loan.due_at)}`);
    doc.font('Helvetica').moveDown(2).fontSize(8).fillColor('#777');
    doc.text('Document généré automatiquement par le service de traitement asynchrone.', { align: 'center' });
    doc.end();
  });
}

module.exports = { renderReceipt };
