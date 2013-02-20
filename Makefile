REPORTER = spec
TESTS = $(wildcard test/test.*.js)
DROPAFTER=false

test:
	@NODE_ENV=test ./node_modules/.bin/mocha $(TESTS) \
		--require "should" \
		--growl \
		--reporter $(REPORTER) \
		--timeout 5000

test-cov: lib-cov
	@TGLR_COV=1 $(MAKE) test REPORTER=html-cov > coverage.html

lib-cov:
	@jscoverage lib lib-cov

clean:
	@rm -rf lib-cov coverage.html

.PHONY: test