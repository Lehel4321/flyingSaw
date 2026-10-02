//go:build !windows

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "The desktop app is Windows only. On other systems open dist/FlyingSaw.html in a browser.")
	os.Exit(1)
}
