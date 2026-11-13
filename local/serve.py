"""Loopback-only server for the bundled DrawingBot app."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json
ROOT = Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT.parent/'dist'),**kwargs)
    def do_GET(self):
        if self.path=='/health':
            body=json.dumps({'app':'drawingbot','version':'1.1.0'}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        else:super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
ThreadingHTTPServer(('127.0.0.1',8788),Handler).serve_forever()
