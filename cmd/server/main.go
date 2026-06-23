// Command server runs the gmp-model HTTP backend: it serves the scenario list
// and, on demand, runs a scenario under tracing and returns a Timeline.
package main

import (
	"flag"
	"log"
	"net/http"

	"gmp-model/internal/api"
	"gmp-model/internal/tracerun"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	flag.Parse()

	handler := api.New(tracerun.Run)

	log.Printf("gmp-model server listening on %s", *addr)
	if err := http.ListenAndServe(*addr, handler); err != nil {
		log.Fatal(err)
	}
}
