# The Python the pipeline and its tests run on: the standard library plus
# numpy, which counts bits a matrix at a time in tools/rhl/drvgraph.py.
{ pkgs }:
pkgs.python3.withPackages (ps: [ ps.numpy ])
