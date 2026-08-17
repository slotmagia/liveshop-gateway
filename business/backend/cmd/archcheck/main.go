// Command archcheck enforces the Gateway architecture rules that coding agents
// and human contributors must satisfy before a change can be integrated.
package main

import (
	"flag"
	"fmt"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"

	gatewayserver "github.com/lvtuopen-ai/liveshop-gateway/backend/internal/gateway/common/server"
)

type checker struct {
	root     string
	failures []string
}

func main() {
	root := flag.String("root", "..", "repository root")
	flag.Parse()
	abs, err := filepath.Abs(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	c := &checker{root: abs}
	c.layout()
	c.goImports()
	c.browserRoutes()
	if len(c.failures) > 0 {
		sort.Strings(c.failures)
		for _, failure := range c.failures {
			fmt.Fprintln(os.Stderr, "ARCH:", failure)
		}
		os.Exit(1)
	}
	fmt.Println("Gateway architecture checks passed.")
}

// layout keeps the data plane to the three directories the standard allows and
// proves it never grows a domain or persistence layer.
func (c *checker) layout() {
	for _, relative := range []string{
		"backend/configs/gateway.yaml",
		"backend/internal/gateway/app",
		"backend/internal/gateway/cmd",
		"backend/internal/gateway/config",
		"backend/internal/gateway/common/server",
	} {
		if _, err := os.Stat(filepath.Join(c.root, filepath.FromSlash(relative))); err != nil {
			c.add("required Gateway path is missing: " + relative)
		}
	}
	for _, forbidden := range []string{"biz", "data", "application", "consistency", "controlplane"} {
		path := filepath.Join(c.root, "backend", "internal", "gateway", forbidden)
		if _, err := os.Stat(path); err == nil {
			c.add("Gateway must not own business facts: backend/internal/gateway/" + forbidden)
		}
	}
}

type layerRule struct {
	scope    string
	contains []string
	message  string
}

var layerRules = []layerRule{
	{
		scope:    "backend/internal/gateway/common/",
		contains: []string{"/internal/gateway/app", "/internal/gateway/config"},
		message:  "the data plane depends on the composition root",
	},
	{
		scope:    "backend/internal/gateway/config/",
		contains: []string{"/internal/gateway/app", "/internal/gateway/common", "net/http"},
		message:  "configuration depends on the runtime",
	},
	{
		scope:    "backend/",
		contains: []string{"module-platform/internal", "/backend/internal/catalog", "database/sql"},
		message:  "Gateway reaches into another module or owns storage",
	},
}

func (c *checker) goImports() {
	backend := filepath.Join(c.root, "backend")
	_ = filepath.WalkDir(backend, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		relative, _ := filepath.Rel(c.root, path)
		slashed := filepath.ToSlash(relative)
		parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ParseComments)
		if err != nil {
			c.add(fmt.Sprintf("%s: parse: %v", slashed, err))
			return nil
		}
		for _, imported := range parsed.Imports {
			value, _ := strconv.Unquote(imported.Path.Value)
			for _, rule := range layerRules {
				if !strings.Contains(slashed, rule.scope) {
					continue
				}
				for _, forbidden := range rule.contains {
					if strings.Contains(value, forbidden) {
						c.add(fmt.Sprintf("%s: %s (%s)", slashed, rule.message, value))
					}
				}
			}
		}
		// The checker names the forbidden calls in its own source, so it is
		// excluded from the text scan below.
		if !strings.Contains(slashed, "backend/cmd/archcheck/") {
			c.noEnvironment(slashed, path)
		}
		return nil
	})
}

// noEnvironment enforces the single-source configuration rule: the process may
// only read the YAML named by -config, so an environment lookup anywhere in the
// backend is a defect rather than a convenience.
func (c *checker) noEnvironment(slashed, path string) {
	source, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, forbidden := range []string{"os.Getenv", "os.LookupEnv", "os.Environ"} {
		if strings.Contains(string(source), forbidden) {
			c.add(fmt.Sprintf("%s: runtime configuration must come from -config, not %s", slashed, forbidden))
		}
	}
}

// browserRoutes proves the declared browser policy and the executed allowlist
// are the same list, so the two cannot drift apart.
func (c *checker) browserRoutes() {
	data, err := os.ReadFile(filepath.Join(c.root, "dependency-policy.yaml"))
	if err != nil {
		c.add("cannot read dependency-policy.yaml: " + err.Error())
		return
	}
	var policy struct {
		BrowserRoutes struct {
			Allow []string `yaml:"allow"`
			Deny  []string `yaml:"deny"`
		} `yaml:"browser_routes"`
	}
	if err := yaml.Unmarshal(data, &policy); err != nil {
		c.add("invalid dependency-policy.yaml: " + err.Error())
		return
	}
	declared := map[string]bool{}
	for _, path := range policy.BrowserRoutes.Allow {
		declared[path] = true
	}
	executed := gatewayserver.BrowserRoutes()
	for path := range executed {
		if !declared[path] {
			c.add("browser route is served but not declared in dependency-policy.yaml: " + path)
		}
		if strings.HasPrefix(path, "/internal/") {
			c.add("internal control-plane route must never be browser reachable: " + path)
		}
	}
	for path := range declared {
		if _, ok := executed[path]; !ok {
			c.add("browser route is declared but not served: " + path)
		}
	}
}

func (c *checker) add(message string) { c.failures = append(c.failures, message) }
