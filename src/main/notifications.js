function createNotifier({ dialog, Notification, icon, getWindow }) {
  return function showNotice(title, body, button, onClick) {
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body, icon });
      if (onClick) notification.on('click', onClick);
      notification.show();
      return;
    }

    const options = { type: 'info', title, message: body, buttons: onClick ? [button, 'Depois'] : ['OK'], cancelId: onClick ? 1 : 0 };
    const currentWindow = getWindow();
    const parent = currentWindow && !currentWindow.isDestroyed() ? currentWindow : undefined;
    const messageBox = parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
    messageBox.then(({ response }) => {
      if (onClick && response === 0) onClick();
    }).catch((error) => console.error('Não foi possível exibir o aviso:', error));
  };
}

module.exports = createNotifier;
