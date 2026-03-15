const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

if (require('electron-squirrel-startup')) app.quit();

const isMac = process.platform === 'darwin';

let mainWindow;
let pendingFile = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // a second instance has been launched, retrieve its file
    const file = commandLine.filter(a => a.endsWith('.svg') && require('fs').existsSync(a)).pop();
    if (file) openFile(file);

    // bring the existing window to the foreground
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow(filesToOpen = []) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false,
    fullscreen: false,
    fullscreenable: true,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();

    mainWindow.webContents.on('before-input-event', (event, input) => {
      // override default chromium selectAll
      if (input.control && input.key === 'a' && input.type === 'keyDown') {
        event.preventDefault();
        mainWindow.webContents.send('editor:select-all');
      }
    });
  });

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      document.body.classList.add('${process.platform}');
    `);

    if (filesToOpen.length > 0) {
      filesToOpen.forEach(filePath => openFile(filePath));
    }
  });

  buildMenu();
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ // MacOS menu
      label: app.name,
      submenu: [
        { role: 'about', label: 'À propos de SVG Editor' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer SVG Editor' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter SVG Editor' },
      ]
    }] : []),
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Nouveau',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu:new-file'),
        },
        {
          label: 'Ouvrir…',
          accelerator: 'CmdOrCtrl+O',
          click: openFileDialog,
        },
        { type: 'separator' },
        {
          label: 'Enregistrer',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu:save'),
        },
        {
          label: 'Enregistrer sous…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('menu:save-as'),
        },
        { type: 'separator' },
        {
          label: 'Fermer l\'onglet',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow.webContents.send('menu:close-tab'),
        },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { type: 'separator' },
        {
          label: 'Formater',
          accelerator: 'Alt+Shift+I',
          click: () => mainWindow.webContents.send('menu:format'),
        },
        {
          label: 'Tout sélectionner',
          accelerator: 'CmdOrCtrl+A',
          click: () => mainWindow.webContents.send('editor:select-all'),
        },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        {
          label: 'Recharger',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.webContents.send('menu:refresh-preview'),
        },
        ...(process.env.NODE_ENV === 'development' ? [
          { type: 'separator' },
          { role: 'toggleDevTools', label: 'Outils développeur' },
        ] : []
        ),
        { type: 'separator' },
        { label: 'Zoom normal', accelerator: 'CmdOrCtrl+num0', role: 'resetZoom' },
        { label: 'Zoom +', accelerator: 'CmdOrCtrl+numadd', role: 'zoomIn' },
        { label: 'Zoom -', accelerator: 'CmdOrCtrl+numsub', role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function openFileDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Ouvrir un fichier SVG',
    filters: [{ name: 'SVG Files', extensions: ['svg'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (!result.canceled) {
    result.filePaths.forEach(fp => openFile(fp));
  }
}

function openFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    mainWindow.webContents.send('file:opened', { path: filePath, content });
  } catch (err) {
    dialog.showErrorBox('Erreur', `Impossible d'ouvrir le fichier :\n${err.message}`);
  }
}

// -------------------- IPC handlers --------------------

ipcMain.handle('dialog:open', openFileDialog);

ipcMain.handle('file:read', (event, filePath) => {
  try {
    return { content: fs.readFileSync(filePath, 'utf-8'), error: null };
  } catch (err) {
    return { content: null, error: err.message };
  }
});

ipcMain.handle('file:save', async (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('dialog:save', async (event, { defaultPath }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Enregistrer le fichier SVG',
    defaultPath: defaultPath || 'nouveau.svg',
    filters: [{ name: 'SVG Files', extensions: ['svg'] }],
  });
  return result;
});

ipcMain.handle('dialog:confirm-close', async (event, { filename }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Enregistrer', 'Ne pas enregistrer', 'Annuler'],
    defaultId: 0,
    cancelId: 2,
    title: 'Modifications non enregistrées',
    message: `"${filename}" a été modifié.`,
    detail: 'Voulez-vous enregistrer les modifications avant de fermer ?',
  });
  return result.response; // 0=save, 1=don't save, 2=cancel
});

// -------------------- --------------------

// Handle file associations (open with / double-click)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    openFile(filePath);
  } else {
    pendingFile = filePath;
  }
});

// Handle Windows/Linux file args
const fileArgs = process.argv.slice(app.isPackaged ? 1 : 2).filter(a => a.endsWith('.svg'));

app.whenReady().then(() => {
  // priority : open-file Mac > args Windows/Linux
  const filesToOpen = pendingFile ? [pendingFile] : fileArgs;
  pendingFile = null;

  createWindow(filesToOpen);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
