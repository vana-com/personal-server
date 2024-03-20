import sys
import os
import logging
from multiprocessing import Process
from threading import Thread
import requests
import time

from PyQt6.QtWidgets import QApplication, QSystemTrayIcon, QMenu
from PyQt6.QtGui import QIcon
from PyQt6.QtCore import pyqtSignal, pyqtSlot

from selfie.__main__ import get_default_gpu_mode

logger = logging.getLogger(__name__)

if getattr(sys, "frozen", False):
    selfie_path = os.path.join(sys._MEIPASS, "selfie")
else:
    selfie_path = os.path.join(os.path.dirname(os.path.abspath(__file__)))


class SystemTrayApp(QApplication):
    server_ready_signal = pyqtSignal(bool)
    server_stopped_signal = pyqtSignal()

    def __init__(self, argv):
        super().__init__(argv)
        self.server_process = None

        self.setQuitOnLastWindowClosed(False)
        self.tray_icon = QSystemTrayIcon(self)
        self.tray_icon.setIcon(QIcon("Selfie.icns"))

        menu = QMenu()

        self.service_action = menu.addAction("Start Service")
        self.service_action.triggered.connect(self.toggle_service)

        self.open_web_action = menu.addAction("Launch UI")
        # TODO: Don't hardcode the port
        self.open_web_action.triggered.connect(lambda: os.system("open http://localhost:8181"))
        self.open_web_action.setVisible(False)

        menu.addSeparator()

        exit_action = menu.addAction("Exit")
        exit_action.triggered.connect(self.quit)

        menu.addSeparator()

        self.gpu_mode_action = menu.addAction("GPU Mode Unknown")
        self.gpu_mode_action.setEnabled(False)
        self.gpu_mode_action.setVisible(False)

        self.tray_icon.setContextMenu(menu)
        self.tray_icon.show()
        self.update_service_icon("stopped")
        self.update_tray_icon_tooltip("Service Stopped")

        self.server_ready_signal.connect(self.post_server_start)
        self.server_stopped_signal.connect(self.post_server_stop)

    def update_gpu_mode_status(self):
        # TODO: Fix this hack
        # config is created in a separate process and is not accessible here
        # config = get_app_config()
        # gpu_mode_enabled = config.get('gpu', None)
        gpu_mode_enabled = get_default_gpu_mode()

        status_text = "GPU Mode Enabled" if gpu_mode_enabled else "GPU Mode Disabled" if gpu_mode_enabled is False else "GPU Mode Unknown"
        self.gpu_mode_action.setText(status_text)
        self.gpu_mode_action.setVisible(True)

    def update_service_icon(self, state):
        icon_paths = {
            "starting": f"{selfie_path}/images/starting-tray.png",
            "stopping": f"{selfie_path}/images/stopping-tray.png",
            "started": f"{selfie_path}/images/started-tray.png",
            "stopped": f"{selfie_path}/images/stopped-tray.png",
        }
        self.tray_icon.setIcon(QIcon(icon_paths[state]))

    def update_tray_icon_tooltip(self, text):
        self.tray_icon.setToolTip(text)

    def toggle_service(self):
        if self.service_action.text() == "Start Service":
            self.start_service()
        else:
            self.stop_service()

    def start_service(self):
        Thread(target=self.start_service_thread).start()

    def start_service_thread(self):
        self.update_service_icon("starting")
        self.service_action.setEnabled(False)
        from selfie.__main__ import start_fastapi_server
        logger.info("Starting service")
        self.update_tray_icon_tooltip("Service Starting...")
        self.server_process = Process(target=start_fastapi_server)
        self.server_process.start()
        self.check_server_ready()

    def check_server_ready(self):
        server_ready = False
        for _ in range(30):  # Try for up to 30 seconds
            try:
                # TODO: Update with health check endpoint
                # TODO: Don't hardcode the port
                response = requests.get("http://localhost:8181/")
                if response.status_code == 200:
                    server_ready = True
                    break
            except requests.ConnectionError:
                pass
            time.sleep(1)
        self.server_ready_signal.emit(server_ready)

    @pyqtSlot(bool)
    def post_server_start(self, server_ready):
        if server_ready:
            logger.info("Service started")
            self.service_action.setText("Stop Service")
            self.update_tray_icon_tooltip("Service Running")
            self.update_service_icon("started")
            self.open_web_action.setVisible(True)
            self.update_gpu_mode_status()
        else:
            logger.error("Failed to start service within the timeout period.")
        self.service_action.setEnabled(True)

    def stop_service(self):
        self.service_action.setEnabled(False)
        Thread(target=self.perform_stop_service).start()

    def perform_stop_service(self):
        if self.server_process and self.server_process.is_alive():
            logger.info("Stopping service")
            self.update_service_icon("stopping")
            self.update_tray_icon_tooltip("Service Stopping...")
            self.server_process.terminate()
            self.server_process.join()
        self.server_stopped_signal.emit()

    @pyqtSlot()
    def post_server_stop(self):
        logger.info("Service stopped")
        self.service_action.setText("Start Service")
        self.update_tray_icon_tooltip("Service Stopped")
        self.update_service_icon("stopped")
        self.open_web_action.setVisible(False)
        self.service_action.setEnabled(True)

    def quit(self):
        self.stop_service()
        super().quit()


if __name__ == "__main__":
    app = SystemTrayApp(sys.argv)
    sys.exit(app.exec())
