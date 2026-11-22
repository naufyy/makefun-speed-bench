// Preload (node --import): prints the process's total CPU seconds (user + sys, every thread)
// on exit to stderr, as "CPU <seconds>". Same measurement the makefun workbench's bench.sh
// has always used, so numbers here are comparable with the local foundations measurements.
process.on('exit', () => {
  const u = process.cpuUsage();
  process.stderr.write(`CPU ${((u.user + u.system) / 1e6).toFixed(3)}\n`);
});
